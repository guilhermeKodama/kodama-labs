import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { createRecurringRule, listRecurringRules, markRulePaid, processDueRules, serializeRule, skipRuleOccurrence, updateRecurringRule, type RecurringRuleInput } from "../recurring-rules";

const USER = "test-user-s5-recurring-001";
let f: LedgerFixture;

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  // 22/set/2026, noon in São Paulo.
  vi.setSystemTime(new Date("2026-09-22T15:00:00Z"));
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const expenseRule = (overrides: Partial<RecurringRuleInput> = {}): RecurringRuleInput => ({
  kind: "expense",
  accountId: f.pfChecking,
  amount: 10,
  description: "GitHub",
  categoryId: f.categories.Software,
  frequency: "monthly",
  startDate: "2026-07-22",
  ...overrides,
});
const occurrences = (ruleId: string) => prisma.ledgerEntry.findMany({ where: { recurringRuleId: ruleId }, orderBy: { date: "asc" } });

describe("creating a rule", () => {
  it("books the occurrences already due in the same batch, at the rate in force, and undo takes them back", async () => {
    // 1 BRL = 0.2 USD in the fixture: USD 10 is BRL 50.
    const rule = await createRecurringRule(USER, expenseRule({ currency: "USD", isTaxDeductible: true }), prisma, { bookDue: true });
    expect(rule.booked.count).toBe(3);
    expect(rule.exchangeRate).toBeNull();
    expect(formatDateOnly(rule.nextDueDate)).toBe("2026-10-22");
    expect(formatDateOnly(rule.lastGeneratedDate!)).toBe("2026-09-22");
    const booked = await occurrences(rule.id);
    expect(booked.map((e) => formatDateOnly(e.date))).toEqual(["2026-07-22", "2026-08-22", "2026-09-22"]);
    expect(booked.every((e) => toNumber(e.amountBase) === -50 && toNumber(e.exchangeRate) === 5 && e.isTaxDeductible && e.categoryId === f.categories.Software)).toBe(true);
    const batch = await prisma.mutationBatch.findUniqueOrThrow({ where: { id: rule.batchId! }, include: { records: true } });
    expect(batch.records.map((r) => r.model).sort()).toEqual(["LedgerEntry", "LedgerEntry", "LedgerEntry", "RecurringRule"]);

    // An explicit rate wins over the one in force.
    const fixed = await createRecurringRule(USER, expenseRule({ currency: "USD", exchangeRate: 4, description: "Figma", startDate: "2026-09-01" }), prisma, { bookDue: true });
    expect((await occurrences(fixed.id)).map((e) => toNumber(e.amountBase))).toEqual([-40]);

    await undoBatch(USER, rule.batchId!, prisma);
    expect(await prisma.ledgerEntry.count({ where: { id: { in: booked.map((e) => e.id) } } })).toBe(0);
    expect(await prisma.recurringRule.count({ where: { id: rule.id } })).toBe(0);
  });

  it("books nothing for a future start or a reminder, stops at the end date, and books transfers as groups", async () => {
    const future = await createRecurringRule(USER, expenseRule({ startDate: "2026-10-01" }), prisma, { bookDue: true });
    expect([future.booked.count, formatDateOnly(future.nextDueDate)]).toEqual([0, "2026-10-01"]);
    const reminder = await createRecurringRule(USER, expenseRule({ startDate: "2026-09-01", autoGenerate: false }), prisma, { bookDue: true });
    expect(reminder.booked.count).toBe(0);
    const ended = await createRecurringRule(USER, expenseRule({ startDate: "2026-07-10", endDate: "2026-08-31" }), prisma, { bookDue: true });
    expect((await occurrences(ended.id)).map((e) => formatDateOnly(e.date))).toEqual(["2026-07-10", "2026-08-10"]);
    // Without bookDue (the service default) the cron books them later.
    const later = await createRecurringRule(USER, expenseRule({ startDate: "2026-09-01" }), prisma);
    expect(later.booked.count).toBe(0);

    const transfer = await createRecurringRule(
      USER,
      { kind: "transfer", accountId: f.pjChecking, toAccountId: f.pfChecking, transferDirection: "profit_distribution", amount: 2000, description: "Pró-labore", frequency: "monthly", startDate: "2026-09-05" },
      prisma,
      { bookDue: true }
    );
    expect(transfer.booked.transferGroupIds).toHaveLength(1);
    const group = await prisma.transferGroup.findUniqueOrThrow({ where: { id: transfer.booked.transferGroupIds[0] }, include: { legs: true } });
    expect(group).toMatchObject({ direction: "profit_distribution", recurringRuleId: transfer.id });
    expect(group.legs.map((l) => toNumber(l.amount)).sort((a, b) => a - b)).toEqual([-2000, 2000]);
  });

  it("uses today in the user's timezone", async () => {
    // 23:00 on the 22nd in São Paulo is already the 23rd in UTC.
    vi.setSystemTime(new Date("2026-09-23T02:00:00Z"));
    const sp = await createRecurringRule(USER, expenseRule({ startDate: "2026-09-23" }), prisma, { bookDue: true });
    expect(sp.booked.count).toBe(0);
    await prisma.user.update({ where: { id: USER }, data: { timezone: "UTC" } });
    const utc = await createRecurringRule(USER, expenseRule({ startDate: "2026-09-23", description: "UTC" }), prisma, { bookDue: true });
    expect(utc.booked.count).toBe(1);
  });
});

describe("editing a rule", () => {
  it("changes amount, frequency, end date, reminders and pause; switching to auto books what is due, undoably", async () => {
    const rule = await createRecurringRule(USER, expenseRule({ startDate: "2026-08-15", autoGenerate: false, amount: 100 }), prisma, { bookDue: true });
    const auto = await updateRecurringRule(USER, rule.id, { autoGenerate: true, amount: 120 }, prisma, { bookDue: true });
    expect(auto.booked.count).toBe(2);
    expect((await occurrences(rule.id)).map((e) => [formatDateOnly(e.date), toNumber(e.amount)])).toEqual([
      ["2026-08-15", -120],
      ["2026-09-15", -120],
    ]);
    expect(formatDateOnly(auto.nextDueDate)).toBe("2026-10-15");

    await undoBatch(USER, auto.batchId!, prisma);
    expect(await prisma.ledgerEntry.count({ where: { recurringRuleId: rule.id } })).toBe(0);
    expect(await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({ autoGenerate: false, nextDueDate: rule.nextDueDate });

    const reminders = { entries: [{ daysBefore: 1, time: "08:00" }], overdue: { enabled: true, time: "09:00" } };
    const paused = await updateRecurringRule(
      USER,
      rule.id,
      { isActive: false, endDate: "2026-12-31", frequency: "yearly", reminders, isTaxDeductible: true, autoGenerate: true },
      prisma,
      { bookDue: true }
    );
    // A paused rule books nothing.
    expect(paused.booked.count).toBe(0);
    expect(serializeRule(paused)).toMatchObject({ isActive: false, endDate: "2026-12-31", frequency: "yearly", reminders, isTaxDeductible: true });
  });

  it("lists rules with their entity, accounts and next due date, within a scope", async () => {
    await createRecurringRule(USER, expenseRule({ startDate: "2026-10-05", autoGenerate: false, description: "Aluguel" }), prisma);
    await createRecurringRule(USER, expenseRule({ accountId: f.pjChecking, startDate: "2026-10-01", autoGenerate: false, description: "DAS" }), prisma);
    const all = (await listRecurringRules(USER, prisma)).map(serializeRule);
    expect(all.map((r) => [r.description, r.nextDueDate, r.entity?.name, r.account?.name])).toEqual([
      ["DAS", "2026-10-01", "Kodama LTDA", "Conta principal"],
      ["Aluguel", "2026-10-05", "PF", "Conta principal"],
    ]);
    expect(all[0]).toMatchObject({ category: { id: f.categories.Software, name: "Software" }, toAccount: null });
    expect((await listRecurringRules(USER, prisma, { entityIds: [f.pfId] })).map((r) => r.description)).toEqual(["Aluguel"]);
  });
});

describe("paying and skipping", () => {
  it("records both in a batch that undo reverts", async () => {
    const rule = await createRecurringRule(USER, expenseRule({ startDate: "2026-09-10", autoGenerate: false, amount: 4200, description: "Aluguel" }), prisma);
    const paid = await markRulePaid(USER, rule.id, prisma, { amount: 4300, date: "2026-09-11" });
    const entry = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: paid.entryIds[0] } });
    expect([formatDateOnly(entry.date), toNumber(entry.amount)]).toEqual(["2026-09-11", -4300]);
    expect(formatDateOnly(paid.rule.nextDueDate)).toBe("2026-10-10");
    const skipped = await skipRuleOccurrence(USER, rule.id, prisma);
    expect(formatDateOnly(skipped.nextDueDate)).toBe("2026-11-10");

    await undoBatch(USER, skipped.batchId, prisma);
    expect(formatDateOnly((await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } })).nextDueDate)).toBe("2026-10-10");
    await undoBatch(USER, paid.batchId, prisma);
    expect(await prisma.ledgerEntry.count({ where: { id: entry.id } })).toBe(0);
    expect(formatDateOnly((await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } })).nextDueDate)).toBe("2026-09-10");
  });

  it("leaves the cron nothing to book after a create that already booked", async () => {
    const rule = await createRecurringRule(USER, expenseRule(), prisma, { bookDue: true });
    const run = await processDueRules(prisma, new Date(), { userId: USER });
    expect(run.results.find((r) => r.ruleId === rule.id)).toBeUndefined();
    expect(await prisma.ledgerEntry.count({ where: { recurringRuleId: rule.id } })).toBe(3);
  });
});
