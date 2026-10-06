import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { withMutationSource } from "../mutations";
import { createEntry, duplicateEntries, restoreEntries, softDeleteEntries, updateEntry } from "../entries";
import { getEntryHistory, type HistoryEvent } from "../history";
import { undoBatch } from "../mutations";
import { learnRule } from "../rules";

const USER = "test-user-s2-entry-history-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const types = (events: HistoryEvent[]) => events.map((e) => e.type);

describe("entry history", () => {
  it("tells where an imported entry came from and which rule categorized it", async () => {
    const rule = (await learnRule(USER, "iFood", f.categories.Groceries, "manual", prisma))!;
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, bankName: "Nubank", fileName: "nubank-2026-09.ofx", transactionCount: 1 } });
    const r = await withMutationSource("import", () =>
      createEntry(USER, { kind: "expense", accountId: f.card, amount: 86.9, description: "iFood", date: "2026-09-21" }, prisma, { importId: imp.id })
    );
    const history = await getEntryHistory(USER, r.entryIds[0], prisma);
    expect(types(history.events)).toEqual(["created", "categorized"]);
    expect(history.events[0]).toMatchObject({ type: "created", source: "import", batchId: r.batchId, import: { bankName: "Nubank", fileType: "OFX", fileName: "nubank-2026-09.ofx" } });
    expect(history.events[1]).toMatchObject({ type: "categorized", by: "rule", rule: { id: rule.id, pattern: "ifood", matchType: "equals" }, categoryId: f.categories.Groceries });
    expect(history.events[1].at).toBe(history.events[0].at);
  });

  it("names the rule an importer chose, and forgets it once the user recategorizes", async () => {
    const rule = (await learnRule(USER, "Uber", f.categories.Software, "manual", prisma))!;
    const r = await createEntry(
      USER,
      { kind: "expense", accountId: f.pfChecking, amount: 23.4, description: "Uber", date: "2026-09-21", categoryId: rule.categoryId },
      prisma,
      { skipRules: true, isAutoCategorized: true, categorizedByRuleId: rule.id }
    );
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } })).categorizedByRuleId).toBe(rule.id);
    await updateEntry(USER, r.entryIds[0], { categoryId: f.categories.Groceries }, prisma);
    const e = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } });
    expect(e).toMatchObject({ categorizedByRuleId: null, isAutoCategorized: false });
    const history = await getEntryHistory(USER, e.id, prisma);
    expect(types(history.events)).toEqual(["created", "updated"]);
    expect(history.events[1]).toMatchObject({ type: "updated", source: "user", changes: [{ field: "categoryId", before: f.categories.Software, after: f.categories.Groceries }] });
  });

  it("lists edits with the fields they changed, deletes and restores, and leaves out undone changes", async () => {
    const r = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 50, description: "Padaria", date: "2026-09-10" }, prisma);
    const id = r.entryIds[0];
    await updateEntry(USER, id, { amount: 55, date: "2026-09-11" }, prisma);
    const undone = await updateEntry(USER, id, { description: "Padaria Real" }, prisma);
    await undoBatch(USER, undone.batchId!, prisma);
    await softDeleteEntries(USER, [id], prisma);
    await restoreEntries(USER, [id], prisma);

    const history = await getEntryHistory(USER, id, prisma);
    expect(types(history.events)).toEqual(["created", "updated", "deleted", "restored"]);
    const edit = history.events[1] as Extract<HistoryEvent, { type: "updated" }>;
    expect(edit.changes).toEqual([
      { field: "amount", before: 50, after: 55 },
      { field: "date", before: "2026-09-10", after: "2026-09-11" },
    ]);
    expect(history.events[0]).toMatchObject({ source: "user", import: null, recurringRule: null });
  });

  it("follows both ends of a transfer", async () => {
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 1000, date: "2026-09-20" }, prisma);
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: t.transferGroupId! } });
    const from = legs.find((l) => l.accountId === f.pjChecking)!;
    await updateEntry(USER, from.id, { toAccountId: f.broker }, prisma);
    const history = await getEntryHistory(USER, from.id, prisma);
    expect(types(history.events)).toEqual(["created", "updated"]);
    expect((history.events[1] as Extract<HistoryEvent, { type: "updated" }>).changes).toEqual(
      expect.arrayContaining([
        { field: "counterpartAccountId", before: f.pfChecking, after: f.broker },
        { field: "direction", before: "profit_distribution", after: "investment_deposit" },
      ])
    );
    expect(history.transferGroupId).toBe(t.transferGroupId);
  });

  it("marks copies and recurrence bookings, and still dates rows written outside the undo log", async () => {
    const r = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Café", date: "2026-09-10" }, prisma);
    const copy = await duplicateEntries(USER, r.entryIds, prisma);
    const copyHistory = await getEntryHistory(USER, copy.entryIds[0], prisma);
    expect(copyHistory.events[0]).toMatchObject({ type: "created", op: "duplicate", duplicatedFrom: r.entryIds[0] });

    const rule = await prisma.recurringRule.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, kind: "expense", amount: 100, currency: "BRL", description: "Aluguel", frequency: "monthly", startDate: new Date("2026-09-01T12:00:00Z"), nextDueDate: new Date("2026-10-01T12:00:00Z") },
    });
    const legacy = await prisma.ledgerEntry.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.pfChecking, kind: "expense", amount: -100, currency: "BRL", amountBase: -100, date: new Date("2026-09-01T12:00:00Z"), effectiveDate: new Date("2026-09-01T12:00:00Z"), description: "Aluguel", recurringRuleId: rule.id, categoryId: f.categories.Groceries, isAutoCategorized: true },
    });
    const history = await getEntryHistory(USER, legacy.id, prisma);
    expect(history.events).toEqual([
      expect.objectContaining({ type: "created", batchId: null, source: null, recurringRule: { id: rule.id, description: "Aluguel", frequency: "monthly", isActive: true } }),
      { type: "categorized", at: null, by: "auto", rule: null, categoryId: f.categories.Groceries },
    ]);
  });

  it("404s on another user's entry", async () => {
    await expect(getEntryHistory(USER, "missing", prisma)).rejects.toMatchObject({ code: "entry.not_found" });
  });
});
