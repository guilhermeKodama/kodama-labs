import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { createRecurringRule, processDueRules } from "@capital/server/modules/recurring/services/recurring-rules";
import { toNumber } from "../../lib/money";
import { createEntry } from "../entries";
import { undoBatch } from "../mutations";
import { deleteWithScope, getDeleteOptions } from "../scope-delete";

const USER = "test-user-s2-scope-delete-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const live = (ids: string[]) => prisma.ledgerEntry.count({ where: { id: { in: ids }, deletedAt: null } });

async function notebook() {
  const r = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 1000, installments: 10, description: "Notebook", date: "2026-09-04" }, prisma);
  const rows = await prisma.ledgerEntry.findMany({ where: { id: { in: r.entryIds } }, orderBy: { installmentNumber: "asc" } });
  return { ids: rows.map((x) => x.id), third: rows[2], planId: rows[0].installmentPlanId! };
}

/** A monthly rent booked by the cron for June to September. */
async function rent() {
  const rule = await createRecurringRule(USER, { kind: "expense", accountId: f.pfChecking, amount: 100, description: "Aluguel", frequency: "monthly", startDate: "2026-06-01" }, prisma);
  await processDueRules(prisma, new Date("2026-09-15T12:00:00Z"), { userId: USER });
  const rows = await prisma.ledgerEntry.findMany({ where: { recurringRuleId: rule.id }, orderBy: { date: "asc" } });
  expect(rows).toHaveLength(4);
  return { rule, rows, ids: rows.map((r) => r.id) };
}

describe("installment scopes", () => {
  it("offers this parcel, this and the later ones, or the whole purchase, with counts and sums", async () => {
    const { third } = await notebook();
    const options = await getDeleteOptions(USER, third.id, prisma);
    expect(options.kind).toBe("installment");
    expect(options.occurrence).toEqual({ n: 3, total: 10 });
    expect(options.scopes.one).toMatchObject({ count: 1, sum: -100 });
    expect(options.scopes.future).toMatchObject({ count: 8, sum: -800 });
    expect(options.scopes.all).toMatchObject({ count: 10, sum: -1000 });
    expect(options.installmentPlan).toMatchObject({ totalInstallments: 10, totalAmount: 1000, isActive: true });
  });

  it("deletes only this parcel, and undo brings it back", async () => {
    const { ids, third, planId } = await notebook();
    const r = await deleteWithScope(USER, third.id, { scope: "one" }, prisma);
    expect(r).toMatchObject({ deleted: 1, installmentPlanClosed: false });
    expect(await live(ids)).toBe(9);
    expect((await prisma.installmentPlan.findUniqueOrThrow({ where: { id: planId } })).isActive).toBe(true);
    await undoBatch(USER, r.batchId, prisma);
    expect(await live(ids)).toBe(10);
  });

  it("deletes this and the later parcels and closes the plan; undo reopens it", async () => {
    const { ids, third, planId } = await notebook();
    const r = await deleteWithScope(USER, third.id, { scope: "future" }, prisma);
    expect(r).toMatchObject({ deleted: 8, sum: -800, installmentPlanClosed: true });
    expect(await live(ids)).toBe(2);
    expect((await prisma.installmentPlan.findUniqueOrThrow({ where: { id: planId } })).isActive).toBe(false);
    await undoBatch(USER, r.batchId, prisma);
    expect(await live(ids)).toBe(10);
    expect((await prisma.installmentPlan.findUniqueOrThrow({ where: { id: planId } })).isActive).toBe(true);
  });

  it("deletes the whole purchase, paid parcels included; undo restores it", async () => {
    const { ids, third, planId } = await notebook();
    const r = await deleteWithScope(USER, third.id, { scope: "all" }, prisma);
    expect(r).toMatchObject({ deleted: 10, installmentPlanClosed: true });
    expect(await live(ids)).toBe(0);
    await undoBatch(USER, r.batchId, prisma);
    expect(await live(ids)).toBe(10);
    expect((await prisma.installmentPlan.findUniqueOrThrow({ where: { id: planId } })).isActive).toBe(true);
  });
});

describe("recurring scopes", () => {
  it("counts the occurrences of the recurrence and where this one falls", async () => {
    const { rows } = await rent();
    const options = await getDeleteOptions(USER, rows[2].id, prisma);
    expect(options.kind).toBe("recurring");
    expect(options.occurrence).toEqual({ n: 3, total: 4 });
    expect(options.scopes.future).toMatchObject({ count: 2, sum: -200, from: "2026-08-01", to: "2026-09-01" });
    expect(options.scopes.all).toMatchObject({ count: 4, sum: -400, from: "2026-06-01" });
    expect(options.recurringRule).toMatchObject({ description: "Aluguel", isActive: true, endDate: null });
  });

  it("deletes one occurrence and leaves the recurrence alone", async () => {
    const { rule, rows, ids } = await rent();
    const r = await deleteWithScope(USER, rows[1].id, { scope: "one" }, prisma);
    expect(r).toMatchObject({ deleted: 1, recurringRuleEnded: false });
    expect(await live(ids)).toBe(3);
    expect(await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({ isActive: true, endDate: null });
    await undoBatch(USER, r.batchId, prisma);
    expect(await live(ids)).toBe(4);
  });

  it("deletes this and the next occurrences and ends the recurrence the day before; undo reopens it", async () => {
    const { rule, rows, ids } = await rent();
    const r = await deleteWithScope(USER, rows[2].id, { scope: "future" }, prisma);
    expect(r).toMatchObject({ deleted: 2, sum: -200, recurringRuleEnded: true });
    expect(await live(ids)).toBe(2);
    const ended = await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(ended.endDate?.toISOString().slice(0, 10)).toBe("2026-07-31");
    expect(ended.isActive).toBe(true);
    // The cron books nothing past the end.
    await processDueRules(prisma, new Date("2026-11-15T12:00:00Z"), { userId: USER });
    expect(await prisma.ledgerEntry.count({ where: { recurringRuleId: rule.id, deletedAt: null } })).toBe(2);

    await undoBatch(USER, r.batchId, prisma);
    expect(await live(ids)).toBe(4);
    expect((await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } })).endDate).toBeNull();
  });

  it("from the first occurrence, 'this and the next' stops the recurrence instead", async () => {
    const { rule, rows, ids } = await rent();
    const r = await deleteWithScope(USER, rows[0].id, { scope: "future" }, prisma);
    expect(r.deleted).toBe(4);
    expect(await live(ids)).toBe(0);
    expect(await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } })).toMatchObject({ isActive: false, endDate: null });
    await undoBatch(USER, r.batchId, prisma);
    expect((await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } })).isActive).toBe(true);
  });

  it("deletes every occurrence and deactivates the recurrence; undo brings both back", async () => {
    const { rule, rows, ids } = await rent();
    const r = await deleteWithScope(USER, rows[3].id, { scope: "all" }, prisma);
    expect(r).toMatchObject({ deleted: 4, sum: -400, recurringRuleEnded: true });
    expect(await live(ids)).toBe(0);
    expect((await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } })).isActive).toBe(false);
    await undoBatch(USER, r.batchId, prisma);
    expect(await live(ids)).toBe(4);
    expect((await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } })).isActive).toBe(true);
  });

  it("counts a recurring transfer once per occurrence", async () => {
    const rule = await createRecurringRule(
      USER,
      { kind: "transfer", accountId: f.pjChecking, toAccountId: f.pfChecking, amount: 1500, description: "Pró-labore", frequency: "monthly", startDate: "2026-08-05" },
      prisma
    );
    await processDueRules(prisma, new Date("2026-09-15T12:00:00Z"), { userId: USER });
    const leg = await prisma.ledgerEntry.findFirstOrThrow({ where: { recurringRuleId: rule.id, accountId: f.pfChecking }, orderBy: { date: "desc" } });
    const options = await getDeleteOptions(USER, leg.id, prisma);
    expect(options.kind).toBe("recurring");
    expect(options.occurrence).toEqual({ n: 2, total: 2 });
    expect(options.scopes.all).toMatchObject({ count: 2, sum: 3000 });
    const r = await deleteWithScope(USER, leg.id, { scope: "all" }, prisma);
    expect(r.deleted).toBe(2);
    expect(await prisma.ledgerEntry.count({ where: { recurringRuleId: rule.id, deletedAt: null } })).toBe(0);
  });
});

describe("linked investment operations", () => {
  async function fundedBuy() {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "etf", ticker: "BOVA11", name: "iShares Ibovespa" }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 62, pricePerUnit: 129.03, totalAmount: 8000, date: "2026-09-16", fundFromAccountId: f.pfChecking }, prisma);
    const legs = await prisma.ledgerEntry.findMany({ where: { transferGroupId: buy.fundingGroupId! } });
    const checkingLeg = legs.find((l) => l.accountId === f.pfChecking)!;
    return { holdingId: h.id, operationId: buy.operation.id, cashEntryId: buy.cashEntryId!, groupLegIds: legs.map((l) => l.id), checkingLeg };
  }

  it("describes the operation the aporte funded", async () => {
    const { checkingLeg, operationId } = await fundedBuy();
    const options = await getDeleteOptions(USER, checkingLeg.id, prisma);
    expect(options.kind).toBe("linked");
    expect(options.scopes.one).toMatchObject({ count: 1, sum: 8000 });
    expect(options.linkedOperation).toMatchObject({ id: operationId, via: "funding", type: "buy", quantity: 62, ticker: "BOVA11", brokerAccountName: "XP", date: "2026-09-16" });
  });

  it("deletes the aporte with its operation, recalculating the position; undo restores everything", async () => {
    const { checkingLeg, operationId, cashEntryId, groupLegIds, holdingId } = await fundedBuy();
    const r = await deleteWithScope(USER, checkingLeg.id, { scope: "one" }, prisma);
    expect(r.operationDeleted).toBe(operationId);
    expect(await prisma.investmentOperation.count({ where: { id: operationId } })).toBe(0);
    expect(await live([cashEntryId, ...groupLegIds])).toBe(0);
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } })).currentQuantity).toBe(0);

    await undoBatch(USER, r.batchId, prisma);
    expect(await prisma.investmentOperation.count({ where: { id: operationId } })).toBe(1);
    expect(await live([cashEntryId, ...groupLegIds])).toBe(3);
    expect((await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } })).currentQuantity).toBe(62);
  });

  it("keeps the operation when asked to", async () => {
    const { checkingLeg, operationId, cashEntryId, groupLegIds } = await fundedBuy();
    const r = await deleteWithScope(USER, checkingLeg.id, { scope: "one", withLinkedOperation: false }, prisma);
    expect(r.operationDeleted).toBeNull();
    expect(await prisma.investmentOperation.count({ where: { id: operationId } })).toBe(1);
    expect(await live(groupLegIds)).toBe(0);
    expect(await live([cashEntryId])).toBe(1);
  });

  it("treats the operation's own cash leg as linked too", async () => {
    const { cashEntryId, operationId, groupLegIds } = await fundedBuy();
    const options = await getDeleteOptions(USER, cashEntryId, prisma);
    expect(options.linkedOperation).toMatchObject({ id: operationId, via: "cash" });
    const r = await deleteWithScope(USER, cashEntryId, {}, prisma);
    expect(r.operationDeleted).toBe(operationId);
    expect(await live([cashEntryId])).toBe(0);
    // The aporte stays: the money is still at the broker.
    expect(await live(groupLegIds)).toBe(2);
  });
});

describe("simple entries", () => {
  it("delete alone and refuse wider scopes", async () => {
    const e = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 86.9, description: "iFood", date: "2026-09-21" }, prisma);
    const options = await getDeleteOptions(USER, e.entryIds[0], prisma);
    expect(options).toMatchObject({ kind: "simple", occurrence: null, scopes: { one: { count: 1, sum: -86.9 } } });
    expect(options.scopes.future).toBeUndefined();
    await expect(deleteWithScope(USER, e.entryIds[0], { scope: "all" }, prisma)).rejects.toMatchObject({ code: "entry.scope_unavailable", status: 422 });
    const r = await deleteWithScope(USER, e.entryIds[0], { scope: "one" }, prisma);
    expect(r).toMatchObject({ kind: "simple", deleted: 1 });
    expect(toNumber((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: e.entryIds[0] } })).amount)).toBe(-86.9);
    expect(await live(e.entryIds)).toBe(0);
  });

  it("404s on a foreign or trashed entry", async () => {
    await expect(getDeleteOptions(USER, "nope", prisma)).rejects.toMatchObject({ code: "entry.not_found" });
  });
});
