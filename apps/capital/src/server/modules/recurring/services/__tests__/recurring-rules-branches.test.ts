import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { undoBatch, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";
import {
  createRecurringRule,
  deleteRecurringRule,
  listRecurringRules,
  markRulePaid,
  materializeRule,
  processDueRules,
  serializeRule,
  skipRuleOccurrence,
  updateRecurringRule,
  RULE_INCLUDE,
  type RecurringRuleInput,
} from "../recurring-rules";

const USER = "test-user-recurring-branches-001";
const OTHER = "test-user-recurring-branches-002";
let f: LedgerFixture;
let o: LedgerFixture;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-22T15:00:00Z"));
  f = await createLedgerFixture(prisma, USER, {
    usdRate: 0.2,
    categories: [
      { name: "Software", type: "expense" },
      { name: "Aluguel", type: "expense" },
      { name: "Salario", type: "income" },
    ],
  });
  o = await createLedgerFixture(prisma, OTHER);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const rule = (overrides: Partial<RecurringRuleInput> = {}): RecurringRuleInput => ({
  kind: "expense",
  accountId: f.pfChecking,
  amount: 10,
  description: "GitHub",
  frequency: "monthly",
  startDate: "2026-09-01",
  ...overrides,
});
const occurrences = (ruleId: string) => prisma.ledgerEntry.findMany({ where: { recurringRuleId: ruleId }, orderBy: { date: "asc" } });
const bill = (data: { recurringRuleId?: string; ledgerEntryId?: string; transferGroupId?: string }) =>
  prisma.attachment.create({ data: { kind: "BILL", blobUrl: "blob://x", pathname: "bills/x.pdf", mimeType: "application/pdf", sizeBytes: 10, originalName: "x.pdf", ...data } });

describe("validation", () => {
  it("refuses a zero or negative amount, and a transfer with no destination", async () => {
    await expect(createRecurringRule(USER, rule({ amount: 0 }), prisma)).rejects.toMatchObject({ status: 422, code: "recurring.invalid_amount" });
    await expect(createRecurringRule(USER, rule({ amount: -5 }), prisma)).rejects.toMatchObject({ code: "recurring.invalid_amount" });
    await expect(createRecurringRule(USER, rule({ kind: "transfer" }), prisma)).rejects.toMatchObject({ status: 422, code: "recurring.transfer_needs_destination" });
    await expect(createRecurringRule(USER, rule({ kind: "transfer", toAccountId: null }), prisma)).rejects.toMatchObject({ code: "recurring.transfer_needs_destination" });
    expect(await prisma.recurringRule.count({ where: { userId: USER } })).toBe(0);
  });

  it("refuses accounts, destinations and categories that are not the user's, and archived categories", async () => {
    await expect(createRecurringRule(USER, rule({ accountId: o.pfChecking }), prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
    await expect(createRecurringRule(USER, rule({ kind: "transfer", toAccountId: o.pfChecking }), prisma)).rejects.toMatchObject({ code: "account.not_found" });
    await expect(createRecurringRule(USER, rule({ categoryId: o.categories.Groceries }), prisma)).rejects.toMatchObject({ status: 404, code: "category.not_found" });
    await prisma.category.update({ where: { id: f.categories.Software }, data: { isArchived: true } });
    await expect(createRecurringRule(USER, rule({ categoryId: f.categories.Software }), prisma)).rejects.toMatchObject({
      status: 422,
      code: "category.archived",
      params: { name: "Software" },
    });
  });

  it("checks the reminders config", async () => {
    await expect(createRecurringRule(USER, rule({ reminders: { entries: [{ daysBefore: 1, time: "25:99" }], overdue: { enabled: true, time: "09:00" } } as never }), prisma)).rejects.toMatchObject({ name: "ZodError" });
  });
});

describe("creating", () => {
  it("stores every field it is given: rate, direction, end date, reminders, category and tax flag", async () => {
    const reminders = { entries: [{ daysBefore: 2, time: "08:30" }], overdue: { enabled: true, time: "10:00" } };
    const created = await createRecurringRule(
      USER,
      rule({ kind: "transfer", toAccountId: f.broker, transferDirection: "investment_deposit", currency: "BRL", exchangeRate: 1, endDate: "2027-01-31", reminders, autoGenerate: false, description: "Aporte" }),
      prisma
    );
    const serialized = serializeRule(created);
    expect(serialized).toMatchObject({ kind: "transfer", toAccountId: f.broker, transferDirection: "investment_deposit", exchangeRate: 1, endDate: "2027-01-31", autoGenerate: false, reminders, lastGeneratedDate: null, nextDueDate: "2026-09-01" });
    const plain = await createRecurringRule(USER, rule({ transferDirection: "card_payment", categoryId: f.categories.Software, isTaxDeductible: true }), prisma);
    // A direction without a destination is dropped.
    expect(plain).toMatchObject({ transferDirection: null, toAccountId: null, categoryId: f.categories.Software, isTaxDeductible: true, endDate: null });
    expect(plain.reminders).toBeNull();
  });

  it("hands its record to the caller's batch", async () => {
    const collect: MutationRecordInput[] = [];
    const created = await createRecurringRule(USER, rule(), prisma, { collect, bookDue: true });
    expect(created.batchId).toBeNull();
    expect(collect.map((r) => r.model)).toEqual(["LedgerEntry", "RecurringRule"]);
    expect(created.booked.count).toBe(1);
  });

  it("serializes relations only when they were loaded", async () => {
    const created = await createRecurringRule(USER, rule({ categoryId: f.categories.Software }), prisma);
    expect(serializeRule(created)).not.toHaveProperty("entity");
    const full = await prisma.recurringRule.findUniqueOrThrow({ where: { id: created.id }, include: RULE_INCLUDE });
    expect(serializeRule(full)).toMatchObject({
      entity: { id: f.pfId, name: "PF", kind: "personal" },
      account: { id: f.pfChecking, type: "checking", currency: "BRL" },
      toAccount: null,
      category: { id: f.categories.Software, name: "Software" },
    });
    const transfer = await createRecurringRule(USER, rule({ kind: "transfer", toAccountId: f.broker }), prisma);
    const withTo = await prisma.recurringRule.findUniqueOrThrow({ where: { id: transfer.id }, include: RULE_INCLUDE });
    expect(serializeRule(withTo)).toMatchObject({ toAccount: { id: f.broker, name: "XP" }, category: null });
  });
});

describe("updating", () => {
  it("404s on a rule that is not the user's", async () => {
    const created = await createRecurringRule(USER, rule(), prisma);
    await expect(updateRecurringRule(OTHER, created.id, { amount: 5 }, prisma)).rejects.toMatchObject({ status: 404, code: "recurring.not_found" });
    await expect(updateRecurringRule(USER, "nope", { amount: 5 }, prisma)).rejects.toMatchObject({ code: "recurring.not_found" });
  });

  it("changes every field in the patch and leaves the rest", async () => {
    const created = await createRecurringRule(USER, rule({ categoryId: f.categories.Software }), prisma);
    const updated = await updateRecurringRule(
      USER,
      created.id,
      {
        accountId: f.pjChecking,
        kind: "income",
        amount: 99.9,
        currency: "USD",
        exchangeRate: 4.5,
        description: "Cliente",
        categoryId: f.categories.Salario,
        isTaxDeductible: true,
        frequency: "weekly",
        startDate: "2026-08-01",
        endDate: "2027-12-31",
        nextDueDate: "2026-10-05",
        autoGenerate: false,
        isActive: false,
        toAccountId: f.pfChecking,
        transferDirection: "profit_distribution",
        reminders: { entries: [], overdue: { enabled: false, time: "09:00" } },
      },
      prisma
    );
    expect(updated).toMatchObject({
      accountId: f.pjChecking,
      entityId: f.pjId,
      kind: "income",
      currency: "USD",
      description: "Cliente",
      categoryId: f.categories.Salario,
      isTaxDeductible: true,
      frequency: "weekly",
      autoGenerate: false,
      isActive: false,
      toAccountId: f.pfChecking,
      transferDirection: "profit_distribution",
    });
    expect([toNumber(updated.amount), toNumber(updated.exchangeRate)]).toEqual([99.9, 4.5]);
    expect([formatDateOnly(updated.startDate), formatDateOnly(updated.endDate!), formatDateOnly(updated.nextDueDate)]).toEqual(["2026-08-01", "2027-12-31", "2026-10-05"]);
    expect(updated.reminders).toEqual({ entries: [], overdue: { enabled: false, time: "09:00" } });

    const cleared = await updateRecurringRule(USER, created.id, { endDate: null, reminders: null, exchangeRate: null }, prisma);
    expect(cleared.endDate).toBeNull();
    expect(cleared.reminders).toBeNull();
    expect(cleared.exchangeRate).toBeNull();
    expect(cleared.description).toBe("Cliente");
    await undoBatch(USER, cleared.batchId!, prisma);
    expect((await prisma.recurringRule.findUniqueOrThrow({ where: { id: created.id } })).reminders).not.toBeNull();
  });

  it("validates the patch against the rule it changes", async () => {
    const created = await createRecurringRule(USER, rule(), prisma);
    await expect(updateRecurringRule(USER, created.id, { amount: 0 }, prisma)).rejects.toMatchObject({ code: "recurring.invalid_amount" });
    await expect(updateRecurringRule(USER, created.id, { kind: "transfer" }, prisma)).rejects.toMatchObject({ code: "recurring.transfer_needs_destination" });
    await expect(updateRecurringRule(USER, created.id, { accountId: o.pfChecking }, prisma)).rejects.toMatchObject({ code: "account.not_found" });
    await expect(updateRecurringRule(USER, created.id, { categoryId: o.categories.Groceries }, prisma)).rejects.toMatchObject({ code: "category.not_found" });
    // An existing transfer rule keeps its destination when only the kind is sent again.
    const transfer = await createRecurringRule(USER, rule({ kind: "transfer", toAccountId: f.broker }), prisma);
    expect((await updateRecurringRule(USER, transfer.id, { kind: "transfer", amount: 11 }, prisma)).toAccountId).toBe(f.broker);
  });

  it("lets a rule keep the archived category it already has, but not take another archived one", async () => {
    const created = await createRecurringRule(USER, rule({ categoryId: f.categories.Software }), prisma);
    await prisma.category.updateMany({ where: { id: { in: [f.categories.Software, f.categories.Aluguel] } }, data: { isArchived: true } });
    const same = await updateRecurringRule(USER, created.id, { categoryId: f.categories.Software, amount: 12 }, prisma);
    expect(toNumber(same.amount)).toBe(12);
    await expect(updateRecurringRule(USER, created.id, { categoryId: f.categories.Aluguel }, prisma)).rejects.toMatchObject({ code: "category.archived" });
  });

  it("collects the record into the caller's batch", async () => {
    const created = await createRecurringRule(USER, rule(), prisma);
    const collect: MutationRecordInput[] = [];
    const updated = await updateRecurringRule(USER, created.id, { amount: 3 }, prisma, { collect });
    expect(updated.batchId).toBeNull();
    expect(collect).toEqual([expect.objectContaining({ model: "RecurringRule", recordId: created.id })]);
  });
});

describe("deleting", () => {
  it("404s, and leaves booked entries, groups and bills in place, unlinked; undo links them back", async () => {
    await expect(deleteRecurringRule(USER, "nope", prisma)).rejects.toMatchObject({ status: 404, code: "recurring.not_found" });
    const created = await createRecurringRule(USER, rule({ kind: "transfer", toAccountId: f.broker, startDate: "2026-08-22" }), prisma, { bookDue: true });
    expect(created.booked.count).toBe(2);
    const entry = await createRecurringRule(USER, rule({ description: "Luz", startDate: "2026-09-22" }), prisma, { bookDue: true });
    await bill({ recurringRuleId: created.id });
    await expect(deleteRecurringRule(OTHER, created.id, prisma)).rejects.toMatchObject({ code: "recurring.not_found" });

    const removed = await deleteRecurringRule(USER, created.id, prisma);
    expect(await prisma.recurringRule.count({ where: { id: created.id } })).toBe(0);
    expect(await prisma.transferGroup.count({ where: { id: { in: created.booked.transferGroupIds }, recurringRuleId: null } })).toBe(2);
    expect(await prisma.ledgerEntry.count({ where: { id: { in: created.booked.entryIds }, recurringRuleId: null } })).toBe(4);
    expect(await prisma.attachment.count({ where: { recurringRuleId: created.id } })).toBe(0);

    await undoBatch(USER, removed.batchId!, prisma);
    expect(await prisma.recurringRule.count({ where: { id: created.id } })).toBe(1);
    expect(await prisma.ledgerEntry.count({ where: { id: { in: created.booked.entryIds }, recurringRuleId: created.id } })).toBe(4);
    expect(await prisma.attachment.count({ where: { recurringRuleId: created.id } })).toBe(1);

    const collect: MutationRecordInput[] = [];
    const collected = await deleteRecurringRule(USER, entry.id, prisma, { collect });
    expect(collected.batchId).toBeNull();
    expect(collect.map((r) => r.model)).toEqual(["RecurringRule", "LedgerEntry"]);
  });
});

describe("listing", () => {
  it("hides paused rules unless asked, and narrows by entity or a resolved scope", async () => {
    const pf = await createRecurringRule(USER, rule({ description: "B", startDate: "2026-10-02" }), prisma);
    const pj = await createRecurringRule(USER, rule({ description: "A", accountId: f.pjChecking, startDate: "2026-10-01" }), prisma);
    const paused = await createRecurringRule(USER, rule({ description: "C", startDate: "2026-10-03" }), prisma);
    await updateRecurringRule(USER, paused.id, { isActive: false }, prisma);
    expect((await listRecurringRules(USER, prisma)).map((r) => r.id)).toEqual([pj.id, pf.id]);
    expect((await listRecurringRules(USER, prisma, { includeInactive: true })).map((r) => r.description)).toEqual(["A", "B", "C"]);
    expect((await listRecurringRules(USER, prisma, { entityId: f.pfId })).map((r) => r.id)).toEqual([pf.id]);
    expect((await listRecurringRules(USER, prisma, { entityIds: [f.pjId] })).map((r) => r.id)).toEqual([pj.id]);
    expect(await listRecurringRules(USER, prisma, { entityIds: [] })).toEqual([]);
    expect((await listRecurringRules(USER, prisma, { entityIds: null })).length).toBe(2);
    expect(await listRecurringRules(OTHER, prisma)).toEqual([]);
  });

  it("orders rules due on the same day by description", async () => {
    await createRecurringRule(USER, rule({ description: "Zebra", startDate: "2026-10-01" }), prisma);
    await createRecurringRule(USER, rule({ description: "Abelha", startDate: "2026-10-01" }), prisma);
    expect((await listRecurringRules(USER, prisma)).map((r) => r.description)).toEqual(["Abelha", "Zebra"]);
  });
});

describe("materializeRule", () => {
  it("books a rule that carries a destination and a direction as a transfer even when its kind is expense", async () => {
    const created = await createRecurringRule(USER, rule({ toAccountId: f.broker, transferDirection: "investment_deposit", description: "Aporte mensal" }), prisma);
    const row = await prisma.recurringRule.findUniqueOrThrow({ where: { id: created.id } });
    const r = await materializeRule(row, new Date("2026-09-10T12:00:00Z"), prisma, { amount: 33 });
    expect(r.transferGroupId).not.toBeNull();
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: r.transferGroupId! }, include: { legs: true } });
    expect(group).toMatchObject({ direction: "investment_deposit", recurringRuleId: created.id });
    expect(group.legs.map((l) => toNumber(l.amount)).sort((a, b) => a - b)).toEqual([-33, 33]);
  });

  it("books an income rule as income, keeping the rule's category without learning rules", async () => {
    const created = await createRecurringRule(USER, rule({ kind: "income", description: "Cliente", categoryId: f.categories.Salario }), prisma);
    await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "cliente", categoryId: f.categories.Aluguel } });
    const row = await prisma.recurringRule.findUniqueOrThrow({ where: { id: created.id } });
    const r = await materializeRule(row, new Date("2026-09-10T12:00:00Z"), prisma);
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } });
    expect(entry).toMatchObject({ kind: "income", categoryId: f.categories.Salario, recurringRuleId: created.id });
    expect(toNumber(entry.amount)).toBe(10);
  });

  it("moves the bills on the template to the first occurrence, an entry or a transfer, and records the move", async () => {
    const simple = await createRecurringRule(USER, rule({ description: "Luz" }), prisma);
    const b1 = await bill({ recurringRuleId: simple.id });
    const records: MutationRecordInput[] = [];
    const first = await materializeRule(await prisma.recurringRule.findUniqueOrThrow({ where: { id: simple.id } }), new Date("2026-09-10T12:00:00Z"), prisma, {}, records);
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: b1.id } })).toMatchObject({ recurringRuleId: null, ledgerEntryId: first.entryIds[0] });
    expect(records.map((r) => r.model)).toEqual(["LedgerEntry", "Attachment"]);

    const second = await materializeRule(await prisma.recurringRule.findUniqueOrThrow({ where: { id: simple.id } }), new Date("2026-10-10T12:00:00Z"), prisma);
    expect(await prisma.attachment.count({ where: { ledgerEntryId: second.entryIds[0] } })).toBe(0);

    const transfer = await createRecurringRule(USER, rule({ kind: "transfer", toAccountId: f.broker, description: "Aporte" }), prisma);
    const b2 = await bill({ recurringRuleId: transfer.id });
    const group = await materializeRule(await prisma.recurringRule.findUniqueOrThrow({ where: { id: transfer.id } }), new Date("2026-09-10T12:00:00Z"), prisma);
    expect(await prisma.attachment.findUniqueOrThrow({ where: { id: b2.id } })).toMatchObject({ recurringRuleId: null, transferGroupId: group.transferGroupId, ledgerEntryId: null });
  });
});

describe("paying and skipping", () => {
  it("404s on a rule that is not the user's", async () => {
    const created = await createRecurringRule(USER, rule(), prisma);
    await expect(markRulePaid(OTHER, created.id, prisma)).rejects.toMatchObject({ status: 404, code: "recurring.not_found" });
    await expect(skipRuleOccurrence(OTHER, created.id, prisma)).rejects.toMatchObject({ code: "recurring.not_found" });
    await expect(skipRuleOccurrence(USER, "nope", prisma)).rejects.toMatchObject({ code: "recurring.not_found" });
  });

  it("books the next occurrence on the day and for the amount it is paid, and advances from the due date", async () => {
    const created = await createRecurringRule(USER, rule({ startDate: "2026-09-30", autoGenerate: false }), prisma);
    const paid = await markRulePaid(USER, created.id, prisma, { date: "2026-09-18", amount: 14.5 });
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid.entryIds[0] } });
    expect([formatDateOnly(entry.date), toNumber(entry.amount)]).toEqual(["2026-09-18", -14.5]);
    expect(formatDateOnly(paid.rule.nextDueDate)).toBe("2026-10-30");
    expect(formatDateOnly(paid.rule.lastGeneratedDate!)).toBe("2026-09-22");
    const asDue = await markRulePaid(USER, created.id, prisma);
    expect(formatDateOnly((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: asDue.entryIds[0] } })).date)).toBe("2026-10-30");
    await undoBatch(USER, asDue.batchId, prisma);
    expect(formatDateOnly((await prisma.recurringRule.findUniqueOrThrow({ where: { id: created.id } })).nextDueDate)).toBe("2026-10-30");
  });

  it("skips to the next occurrence without booking anything", async () => {
    const created = await createRecurringRule(USER, rule({ startDate: "2026-09-30", frequency: "weekly" }), prisma);
    const skipped = await skipRuleOccurrence(USER, created.id, prisma);
    expect(formatDateOnly(skipped.nextDueDate)).toBe("2026-10-07");
    expect(await occurrences(created.id)).toHaveLength(0);
  });
});

describe("processDueRules", () => {
  it("books each user's due rules as a system batch, or only one user's", async () => {
    const mine = await createRecurringRule(USER, rule({ startDate: "2026-08-22", description: "Minha" }), prisma);
    const theirs = await createRecurringRule(OTHER, { kind: "expense", accountId: o.pfChecking, amount: 5, description: "Dela", frequency: "monthly", startDate: "2026-08-22" }, prisma);
    const scoped = await processDueRules(prisma, new Date("2026-09-22T15:00:00Z"), { userId: USER });
    expect(scoped).toMatchObject({ processed: 1, generated: 2 });
    expect(scoped.results[0]).toMatchObject({ ruleId: mine.id, generated: 2, nextDueDate: "2026-10-22" });
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: scoped.results[0].batchId } })).source).toBe("system");
    expect(await occurrences(theirs.id)).toHaveLength(0);

    const rest = await processDueRules(prisma, new Date("2026-09-22T15:00:00Z"), { userId: OTHER });
    expect(rest.generated).toBe(2);
    expect(await processDueRules(prisma, new Date("2026-09-22T15:00:00Z"), { userId: USER })).toEqual({ processed: 0, generated: 0, results: [] });
  });

  it("leaves reminders and paused rules alone", async () => {
    await createRecurringRule(USER, rule({ startDate: "2026-08-22", autoGenerate: false, description: "Lembrete" }), prisma);
    const paused = await createRecurringRule(USER, rule({ startDate: "2026-08-22", description: "Pausada" }), prisma);
    await updateRecurringRule(USER, paused.id, { isActive: false }, prisma);
    expect(await processDueRules(prisma, new Date("2026-09-22T15:00:00Z"), { userId: USER })).toEqual({ processed: 0, generated: 0, results: [] });
  });

  it("books through the end date and books transfer rules as groups", async () => {
    const ending = await createRecurringRule(USER, rule({ startDate: "2026-07-22", endDate: "2026-09-30", description: "Curta" }), prisma);
    const transfer = await createRecurringRule(USER, rule({ kind: "transfer", toAccountId: f.pjChecking, startDate: "2026-09-22", description: "Repasse" }), prisma);
    const r = await processDueRules(prisma, new Date("2026-09-22T15:00:00Z"), { userId: USER });
    expect(Object.fromEntries(r.results.map((x) => [x.ruleId, x.generated]))).toEqual({ [ending.id]: 3, [transfer.id]: 1 });
    expect((await occurrences(ending.id)).map((e) => formatDateOnly(e.date))).toEqual(["2026-07-22", "2026-08-22", "2026-09-22"]);
    expect(await prisma.transferGroup.count({ where: { recurringRuleId: transfer.id } })).toBe(1);
  });
});
