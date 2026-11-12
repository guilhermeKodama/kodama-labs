import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createRecurringRule, processDueRules } from "@capital/server/modules/recurring/services/recurring-rules";
import { createEntry } from "../entries";
import { deleteWithScope, getDeleteOptions } from "../scope-delete";

const USER = "test-user-ledger-scope-branches-001";
const OTHER = "test-user-ledger-scope-branches-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const live = (ids: string[]) => prisma.ledgerEntry.count({ where: { id: { in: ids }, deletedAt: null } });

/** A monthly rent booked by the cron for June to September 2026. */
async function rent(extra: Record<string, unknown> = {}) {
  const rule = await createRecurringRule(USER, { kind: "expense", accountId: f.pfChecking, amount: 100, description: "Aluguel", frequency: "monthly", startDate: "2026-06-01", ...extra } as never, prisma);
  await processDueRules(prisma, new Date("2026-09-15T12:00:00Z"), { userId: USER });
  const rows = await prisma.ledgerEntry.findMany({ where: { recurringRuleId: rule.id }, orderBy: { date: "asc" } });
  return { rule, rows, ids: rows.map((r) => r.id) };
}

async function notebook() {
  const r = await createEntry(USER, { kind: "expense", accountId: f.card, amount: 300, installments: 3, description: "Notebook", date: "2026-09-04" }, prisma);
  const rows = await prisma.ledgerEntry.findMany({ where: { id: { in: r.entryIds } }, orderBy: { installmentNumber: "asc" } });
  return { rows, ids: rows.map((x) => x.id), planId: rows[0].installmentPlanId! };
}

describe("scope without a recurrence or a plan", () => {
  it("refuses a wider scope on a simple entry, and 404s on another user's or a trashed one", async () => {
    const e = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Cafe", date: "2026-09-10" }, prisma);
    const id = e.entryIds[0];
    await expect(deleteWithScope(USER, id, { scope: "future" }, prisma)).rejects.toMatchObject({ status: 422, code: "entry.scope_unavailable" });
    await expect(deleteWithScope(USER, id, { scope: "all" }, prisma)).rejects.toMatchObject({ code: "entry.scope_unavailable" });
    await expect(getDeleteOptions(OTHER, id, prisma)).rejects.toMatchObject({ status: 404, code: "entry.not_found" });
    expect(await live([id])).toBe(1);
    const options = await getDeleteOptions(USER, id, prisma);
    expect(options).toMatchObject({ kind: "simple", occurrence: null, scopes: { one: { count: 1, sum: -10, from: "2026-09-10", to: "2026-09-10" } }, recurringRule: null, installmentPlan: null, linkedOperation: null });
    expect(options.scopes.future).toBeUndefined();
  });
});

describe("installment plans", () => {
  it("treats a parcel with no number as the first one", async () => {
    const { rows, ids } = await notebook();
    await prisma.ledgerEntry.update({ where: { id: rows[1].id }, data: { installmentNumber: null } });
    const options = await getDeleteOptions(USER, rows[1].id, prisma);
    expect(options.occurrence).toEqual({ n: 1, total: 3 });
    // "This and the later ones" from a parcel read as number 1 takes every numbered parcel.
    expect(options.scopes.future).toMatchObject({ count: 2 });
    const r = await deleteWithScope(USER, rows[1].id, { scope: "future" }, prisma);
    expect(r.deleted).toBe(2);
    expect(await live(ids)).toBe(1);
  });

  it("does not close a plan that is already closed, and reports the plan as inactive", async () => {
    const { rows, planId } = await notebook();
    await prisma.installmentPlan.update({ where: { id: planId }, data: { isActive: false } });
    expect((await getDeleteOptions(USER, rows[0].id, prisma)).installmentPlan).toMatchObject({ id: planId, isActive: false, totalInstallments: 3, totalAmount: 300, installmentAmount: 100 });
    const r = await deleteWithScope(USER, rows[0].id, { scope: "all" }, prisma);
    expect(r).toMatchObject({ kind: "installment", deleted: 3, installmentPlanClosed: false });
  });
});

describe("recurring rules", () => {
  it("reports the end date of a recurrence that has one", async () => {
    const { rows } = await rent({ endDate: "2026-12-31" });
    const options = await getDeleteOptions(USER, rows[0].id, prisma);
    expect(options.recurringRule).toMatchObject({ endDate: "2026-12-31", isActive: true });
  });

  it("leaves an inactive recurrence as it is when wider scopes are deleted", async () => {
    const { rule, rows, ids } = await rent();
    await prisma.recurringRule.update({ where: { id: rule.id }, data: { isActive: false } });
    const r = await deleteWithScope(USER, rows[2].id, { scope: "future" }, prisma);
    expect(r).toMatchObject({ deleted: 2, recurringRuleEnded: false });
    expect(await live(ids)).toBe(2);
    const all = await deleteWithScope(USER, rows[0].id, { scope: "all" }, prisma);
    expect(all).toMatchObject({ recurringRuleEnded: false });
  });

  it("keeps an end date that already falls before the day it would be set to", async () => {
    const { rule, rows } = await rent();
    await prisma.recurringRule.update({ where: { id: rule.id }, data: { endDate: new Date("2026-07-15T12:00:00Z") } });
    const r = await deleteWithScope(USER, rows[3].id, { scope: "future" }, prisma);
    expect(r).toMatchObject({ deleted: 1, recurringRuleEnded: false });
    const kept = await prisma.recurringRule.findUniqueOrThrow({ where: { id: rule.id } });
    expect(kept.endDate?.toISOString().slice(0, 10)).toBe("2026-07-15");
    expect(kept.isActive).toBe(true);
  });

  it("orders occurrences that fall on the same day by their key and numbers this one among them", async () => {
    const { rows } = await rent();
    await prisma.ledgerEntry.updateMany({ where: { id: { in: [rows[1].id, rows[2].id] } }, data: { date: rows[1].date } });
    const options = await getDeleteOptions(USER, rows[2].id, prisma);
    expect(options.occurrence?.total).toBe(4);
    expect([2, 3]).toContain(options.occurrence?.n);
    expect(options.scopes.all).toMatchObject({ count: 4 });
  });

  it("deletes occurrences of a recurring transfer through either of its legs", async () => {
    const rule = await createRecurringRule(USER, { kind: "transfer", accountId: f.pjChecking, toAccountId: f.pfChecking, amount: 500, description: "Pro-labore", frequency: "monthly", startDate: "2026-08-05" }, prisma);
    await processDueRules(prisma, new Date("2026-09-15T12:00:00Z"), { userId: USER });
    const leg = await prisma.ledgerEntry.findFirstOrThrow({ where: { recurringRuleId: rule.id, accountId: f.pjChecking }, orderBy: { date: "asc" } });
    const options = await getDeleteOptions(USER, leg.id, prisma);
    expect(options.scopes.future).toMatchObject({ count: 2, sum: 1000 });
    expect(options.occurrence).toEqual({ n: 1, total: 2 });
    const r = await deleteWithScope(USER, leg.id, { scope: "future" }, prisma);
    expect(r).toMatchObject({ deleted: 2, kind: "recurring", recurringRuleEnded: true });
    expect(await prisma.ledgerEntry.count({ where: { recurringRuleId: rule.id, deletedAt: null } })).toBe(0);
  });
});
