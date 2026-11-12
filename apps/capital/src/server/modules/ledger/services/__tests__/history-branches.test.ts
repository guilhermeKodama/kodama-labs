import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "../entries";
import { getEntryHistory, type HistoryEvent } from "../history";

const USER = "test-user-ledger-history-branches-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

type Updated = Extract<HistoryEvent, { type: "updated" }>;
const at = (iso: string) => new Date(iso);

/** One undo-log batch with hand-written records, to reach shapes the writers never produce. */
async function batch(
  createdAt: string,
  op: string,
  records: { model: string; recordId: string; before: unknown; after: unknown }[],
  extra: { source?: string; undoneAt?: Date } = {}
) {
  return prisma.mutationBatch.create({
    data: {
      userId: USER,
      op,
      createdAt: at(createdAt),
      ...extra,
      records: { create: records.map((r) => ({ model: r.model, recordId: r.recordId, before: r.before as Prisma.InputJsonValue, after: r.after as Prisma.InputJsonValue })) },
    },
  });
}

const legacyEntry = (overrides: Record<string, unknown> = {}) =>
  prisma.ledgerEntry.create({
    data: {
      userId: USER,
      entityId: f.pfId,
      accountId: f.pfChecking,
      kind: "expense",
      amount: -10,
      currency: "BRL",
      amountBase: -10,
      date: at("2026-09-01T12:00:00Z"),
      effectiveDate: at("2026-09-01T12:00:00Z"),
      description: "Legado",
      ...overrides,
    } as Prisma.LedgerEntryUncheckedCreateInput,
  });

describe("origin of an entry", () => {
  it("reads the file type off the name, and none when there is no extension", async () => {
    const named = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Inter", fileName: "fatura.pdf", transactionCount: 1 } });
    const bare = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, fileName: "extrato", transactionCount: 1 } });
    const none = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, transactionCount: 1 } });
    const history = async (importId: string) => {
      const e = await legacyEntry({ importId });
      return (await getEntryHistory(USER, e.id, prisma)).events[0] as Extract<HistoryEvent, { type: "created" }>;
    };
    expect((await history(named.id)).import).toMatchObject({ fileType: "PDF", bankName: "Inter" });
    expect((await history(bare.id)).import).toMatchObject({ fileType: null, fileName: "extrato" });
    expect((await history(none.id)).import).toMatchObject({ fileType: null, fileName: null, bankName: null });
    // A row written without a batch still says it came from an import.
    expect((await history(named.id)).source).toBe("import");
  });

  it("says when the import it came from was reverted", async () => {
    const reverted = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, transactionCount: 1, revertedAt: at("2026-09-30T10:00:00Z"), source: "agent" } });
    const e = await legacyEntry({ importId: reverted.id });
    const created = (await getEntryHistory(USER, e.id, prisma)).events[0] as Extract<HistoryEvent, { type: "created" }>;
    expect(created.import).toMatchObject({ revertedAt: "2026-09-30T10:00:00.000Z", source: "agent" });
  });

  it("numbers the parcel of an installment purchase", async () => {
    const r = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 300, installments: 3, description: "TV", date: "2026-09-04" }, prisma);
    const second = await prisma.ledgerEntry.findFirstOrThrow({ where: { id: { in: r.entryIds }, installmentNumber: 2 } });
    const created = (await getEntryHistory(USER, second.id, prisma)).events[0] as Extract<HistoryEvent, { type: "created" }>;
    expect(created.installment).toEqual({ n: 2, total: 3 });
    const plain = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, description: "Cafe", date: "2026-09-04" }, prisma);
    expect(((await getEntryHistory(USER, plain.entryIds[0], prisma)).events[0] as Extract<HistoryEvent, { type: "created" }>).installment).toBeNull();
  });

  it("takes the import and the recurring rule of a transfer from its group", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, fileName: "x.csv", transactionCount: 2 } });
    const rule = await prisma.recurringRule.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, kind: "transfer", amount: 10, currency: "BRL", description: "Aporte", frequency: "monthly", startDate: at("2026-09-01T12:00:00Z"), nextDueDate: at("2026-10-01T12:00:00Z"), isActive: false },
    });
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10, date: "2026-09-20" }, prisma);
    await prisma.transferGroup.update({ where: { id: t.transferGroupId! }, data: { importId: imp.id, recurringRuleId: rule.id } });
    const created = (await getEntryHistory(USER, t.entryIds[0], prisma)).events[0] as Extract<HistoryEvent, { type: "created" }>;
    expect(created.import).toMatchObject({ id: imp.id, fileType: "CSV" });
    expect(created.recurringRule).toEqual({ id: rule.id, description: "Aporte", frequency: "monthly", isActive: false });
  });

  it("dates a legacy transfer by its group and ignores a duplicatedFrom that is not an id", async () => {
    const group = await prisma.transferGroup.create({ data: { userId: USER, direction: "between_accounts", description: "Antigo", date: at("2026-08-01T12:00:00Z"), createdAt: at("2026-08-02T09:00:00Z") } });
    const leg = await legacyEntry({ transferGroupId: group.id, kind: "transfer", metadata: { duplicatedFrom: 42 } });
    const history = await getEntryHistory(USER, leg.id, prisma);
    expect(history.events).toEqual([expect.objectContaining({ type: "created", at: "2026-08-02T09:00:00.000Z", duplicatedFrom: null, batchId: null })]);
    expect(history.transferGroupId).toBe(group.id);
  });
});

describe("events from hand-written batches", () => {
  const snap = (e: Record<string, unknown>, overrides: Record<string, unknown> = {}) => ({
    description: e.description,
    amount: "-10",
    kind: "expense",
    date: "2026-09-01T12:00:00.000Z",
    categoryId: null,
    accountId: e.accountId,
    deletedAt: null,
    ...overrides,
  });

  it("reports one creation however many batches carry a null before, and skips the rest of that batch", async () => {
    const e = await legacyEntry();
    await batch("2026-09-01T10:00:00Z", "create", [{ model: "LedgerEntry", recordId: e.id, before: null, after: snap(e) }]);
    await batch("2026-09-01T11:00:00Z", "create", [{ model: "LedgerEntry", recordId: e.id, before: null, after: snap(e) }]);
    const events = (await getEntryHistory(USER, e.id, prisma)).events;
    expect(events.map((x) => x.type)).toEqual(["created"]);
    expect(events[0]).toMatchObject({ at: "2026-09-01T10:00:00.000Z", op: "create", source: "user" });
  });

  it("reads a deletion off the deletedAt of the entry or, when only its sibling is recorded, of the sibling", async () => {
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 100, date: "2026-09-20", description: "Aporte" }, prisma);
    const [mine, other] = t.entryIds;
    await prisma.mutationBatch.deleteMany({ where: { userId: USER } });
    const live = { kind: "transfer", description: "Aporte", amount: "100", deletedAt: null };
    const trashed = { ...live, deletedAt: "2026-09-02T10:00:00.000Z" };
    await batch("2026-09-01T10:00:00Z", "create", [{ model: "LedgerEntry", recordId: mine, before: null, after: live }]);
    await batch("2026-09-02T10:00:00Z", "delete", [{ model: "LedgerEntry", recordId: mine, before: live, after: trashed }], { source: "assistant" });
    await batch("2026-09-03T10:00:00Z", "restore", [{ model: "LedgerEntry", recordId: other, before: trashed, after: live }]);
    const events = (await getEntryHistory(USER, mine, prisma)).events;
    expect(events.map((x) => x.type)).toEqual(["created", "deleted", "restored"]);
    expect(events[1]).toMatchObject({ source: "assistant", op: "delete", at: "2026-09-02T10:00:00.000Z" });
    expect(events[2]).toMatchObject({ source: "user", op: "restore" });
  });

  it("describes a change of the amount, date and fields that are missing from a snapshot", async () => {
    const e = await legacyEntry();
    await batch("2026-09-01T10:00:00Z", "create", [{ model: "LedgerEntry", recordId: e.id, before: null, after: snap(e) }]);
    await batch("2026-09-02T10:00:00Z", "update", [
      {
        model: "LedgerEntry",
        recordId: e.id,
        before: { kind: "income", amount: "100", exchangeRate: "1", date: null, notes: null },
        after: { kind: "income", amount: "120.5", exchangeRate: "5.25", date: 20260905, notes: "nova", isTaxDeductible: true },
      },
    ]);
    const updated = (await getEntryHistory(USER, e.id, prisma)).events[1] as Updated;
    expect(updated.changes).toEqual(
      expect.arrayContaining([
        { field: "amount", before: 100, after: 120.5 },
        { field: "exchangeRate", before: 1, after: 5.25 },
        { field: "notes", before: null, after: "nova" },
        { field: "isTaxDeductible", before: null, after: true },
      ])
    );
    // A date that is not an ISO string reads as nothing, before and after.
    expect(updated.changes.find((c) => c.field === "date")).toBeUndefined();
  });

  it("shows a change recorded only on the other leg of a transfer, with the shared fields", async () => {
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 100, date: "2026-09-20", description: "Aporte" }, prisma);
    const [mine, other] = t.entryIds;
    await prisma.mutationBatch.deleteMany({ where: { userId: USER } });
    await batch("2026-09-10T10:00:00Z", "update", [
      {
        model: "LedgerEntry",
        recordId: other,
        before: { kind: "transfer", description: "Aporte", amount: "100", date: "2026-09-20T12:00:00.000Z", notes: null, accountId: f.broker },
        after: { kind: "transfer", description: "Aporte maior", amount: "150", date: "2026-09-21T12:00:00.000Z", notes: "n", accountId: f.pjChecking },
      },
    ]);
    const events = (await getEntryHistory(USER, mine, prisma)).events;
    const updated = events.find((x) => x.type === "updated") as Updated;
    expect(updated.changes).toEqual(
      expect.arrayContaining([
        { field: "counterpartAccountId", before: f.broker, after: f.pjChecking },
        { field: "description", before: "Aporte", after: "Aporte maior" },
        { field: "amount", before: 100, after: 150 },
        { field: "date", before: "2026-09-20", after: "2026-09-21" },
        { field: "notes", before: null, after: "n" },
      ])
    );
    // No batch carried the creation: the group dates it.
    expect(events.find((x) => x.type === "created")).toMatchObject({ batchId: null, at: (await prisma.transferGroup.findUniqueOrThrow({ where: { id: t.transferGroupId! } })).createdAt.toISOString() });
  });

  it("shows a change of the transfer group's direction alone, and nothing for a batch that changes nothing", async () => {
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 100, date: "2026-09-20" }, prisma);
    await prisma.mutationBatch.deleteMany({ where: { userId: USER } });
    await batch("2026-09-10T10:00:00Z", "update", [{ model: "TransferGroup", recordId: t.transferGroupId!, before: { direction: "between_accounts" }, after: { direction: "capital_injection" } }]);
    await batch("2026-09-11T10:00:00Z", "update", [{ model: "TransferGroup", recordId: t.transferGroupId!, before: { direction: "capital_injection" }, after: { direction: "capital_injection" } }]);
    const updates = (await getEntryHistory(USER, t.entryIds[0], prisma)).events.filter((x) => x.type === "updated") as Updated[];
    expect(updates).toHaveLength(1);
    expect(updates[0].changes).toEqual([{ field: "direction", before: "between_accounts", after: "capital_injection" }]);
  });

  it("dates the rule's categorization at the batch that set it, and keeps the first one", async () => {
    const rule = await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "uber", categoryId: f.categories.Software } });
    const e = await legacyEntry({ categoryId: f.categories.Software, categorizedByRuleId: rule.id, isAutoCategorized: true });
    await batch("2026-09-01T10:00:00Z", "create", [{ model: "LedgerEntry", recordId: e.id, before: null, after: snap(e) }]);
    await batch("2026-09-02T10:00:00Z", "update", [
      { model: "LedgerEntry", recordId: e.id, before: snap(e, { categorizedByRuleId: null }), after: snap(e, { categorizedByRuleId: rule.id, categoryId: f.categories.Software }) },
    ]);
    await batch("2026-09-03T10:00:00Z", "update", [
      { model: "LedgerEntry", recordId: e.id, before: snap(e, { categorizedByRuleId: null }), after: snap(e, { categorizedByRuleId: rule.id, categoryId: f.categories.Software }) },
    ]);
    const events = (await getEntryHistory(USER, e.id, prisma)).events;
    const categorized = events.find((x) => x.type === "categorized");
    expect(categorized).toMatchObject({ at: "2026-09-02T10:00:00.000Z", by: "rule", rule: { id: rule.id, pattern: "uber", matchType: "contains" }, categoryId: f.categories.Software });
    // The categorization sorts among the other events by its date, ahead of the edit of the same batch.
    expect(events.map((x) => x.type)).toEqual(["created", "categorized", "updated", "updated"]);
  });

  it("puts an undated automatic categorization right after the creation, before later edits", async () => {
    const e = await legacyEntry({ categoryId: f.categories.Groceries, isAutoCategorized: true });
    await batch("2026-09-01T10:00:00Z", "create", [{ model: "LedgerEntry", recordId: e.id, before: null, after: snap(e) }]);
    await batch("2026-09-05T10:00:00Z", "update", [{ model: "LedgerEntry", recordId: e.id, before: snap(e), after: snap(e, { description: "Outro" }) }]);
    const events = (await getEntryHistory(USER, e.id, prisma)).events;
    expect(events.map((x) => x.type)).toEqual(["created", "categorized", "updated"]);
    expect(events[1]).toEqual({ type: "categorized", at: null, by: "auto", rule: null, categoryId: f.categories.Groceries });
  });

  it("leaves out the batches that were undone", async () => {
    const e = await legacyEntry();
    await batch("2026-09-01T10:00:00Z", "create", [{ model: "LedgerEntry", recordId: e.id, before: null, after: snap(e) }]);
    await batch("2026-09-02T10:00:00Z", "update", [{ model: "LedgerEntry", recordId: e.id, before: snap(e), after: snap(e, { description: "X" }) }], { undoneAt: at("2026-09-02T11:00:00Z") });
    expect((await getEntryHistory(USER, e.id, prisma)).events.map((x) => x.type)).toEqual(["created"]);
  });
});
