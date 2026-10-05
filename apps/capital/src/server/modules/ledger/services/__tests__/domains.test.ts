import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createBudget } from "@capital/server/modules/budgets/services/budget-crud";
import { monthOverview, yearOverview } from "@capital/server/modules/budgets/services/budget-overview";
import { createRecurringRule, markRulePaid, processDueRules, skipRuleOccurrence } from "@capital/server/modules/recurring/services/recurring-rules";
import {
  contributions,
  createHolding,
  deleteOperation,
  portfolioSummary,
  rebalanceSuggestion,
  recordOperation,
  setTargets,
} from "@capital/server/modules/investments/services/portfolio";
import { deleteCategory, mergeCategories, updateCategory } from "@capital/server/modules/categories/services/categories";
import { accountBalances } from "../accounts";
import { createEntry } from "../entries";
import { createRule } from "../rules";
import { toNumber } from "../../lib/money";

const USER = "test-user-ledger-domains-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const expense = (accountId: string, amount: number, date: string, categoryId = f.categories.Groceries) =>
  createEntry(USER, { kind: "expense", accountId, amount, date, description: "x", categoryId }, prisma);

describe("budgets", () => {
  it("compares spend (card purchases on their closing date, no transfer legs) with the month's budget", async () => {
    await createBudget(USER, { categoryId: f.categories.Groceries, amount: 1000, effectiveFrom: "2026-01" }, prisma);
    await expense(f.pfChecking, 300, "2026-08-10");
    await expense(f.card, 200, "2026-08-02"); // closes on 2026-08-05
    await expense(f.card, 999, "2026-08-20"); // next statement: September
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 5000, date: "2026-08-15", direction: "profit_distribution" }, prisma);

    const o = await monthOverview(USER, 2026, 8, prisma);
    const groceries = o.budgets.find((b) => b.categoryId === f.categories.Groceries)!;
    expect(groceries).toMatchObject({ amount: 1000, spent: 500, committed: 500, remaining: 500, isOverBudget: false });
    expect(o.period.daysElapsed).toBe(31);
    expect(o.series.at(-1)!.cumulative).toBe(500);
  });

  it("carries unspent budget forward with rollover and scopes by entity", async () => {
    await createBudget(USER, { entityId: f.pfId, categoryId: f.categories.Groceries, amount: 400, effectiveFrom: "2026-07", rollover: true }, prisma);
    await expense(f.pfChecking, 100, "2026-07-10");
    await expense(f.pjChecking, 700, "2026-08-10");
    const o = await monthOverview(USER, 2026, 8, prisma, { entityId: f.pfId });
    expect(o.budgets[0]).toMatchObject({ carry: 300, available: 700, spent: 0 });
    expect(o.unbudgeted).toEqual([]);
  });

  it("rejects a second budget for the same category and month", async () => {
    await createBudget(USER, { categoryId: f.categories.Groceries, amount: 100, effectiveFrom: "2026-08" }, prisma);
    await expect(createBudget(USER, { categoryId: f.categories.Groceries, amount: 200, effectiveFrom: "2026-08-15" }, prisma)).rejects.toThrow();
  });

  it("builds the category x month matrix with budgets per month", async () => {
    await createBudget(USER, { categoryId: f.categories.Groceries, amount: 250, effectiveFrom: "2026-03" }, prisma);
    await expense(f.pfChecking, 100, "2026-02-10");
    await expense(f.pfChecking, 300, "2026-04-10");
    const y = await yearOverview(USER, 2026, prisma);
    const row = y.categories.find((c) => c.categoryId === f.categories.Groceries)!;
    expect(row.months[1]).toMatchObject({ month: 2, spent: 100, budget: null, isProjected: false });
    expect(row.months[3]).toMatchObject({ month: 4, spent: 300, budget: 250 });
    expect(row.overMonths).toBe(1);
    expect(y.monthBudgets[0]).toBe(0);
    expect(y.monthBudgets[2]).toBe(250);
  });
});

describe("recurring rules", () => {
  it("books due occurrences of auto rules and leaves reminder rules overdue", async () => {
    const auto = await createRecurringRule(
      USER,
      { kind: "expense", accountId: f.pfChecking, amount: 50, description: "Spotify", categoryId: f.categories.Software, frequency: "monthly", startDate: "2026-07-10", autoGenerate: true },
      prisma
    );
    const reminder = await createRecurringRule(
      USER,
      { kind: "expense", accountId: f.pfChecking, amount: 900, description: "Aluguel", frequency: "monthly", startDate: "2026-08-01", autoGenerate: false },
      prisma
    );
    await processDueRules(prisma, new Date("2026-09-15T12:00:00Z"));
    const booked = await prisma.ledgerEntry.findMany({ where: { recurringRuleId: auto.id }, orderBy: { date: "asc" } });
    expect(booked.map((e) => e.date.toISOString().slice(0, 10))).toEqual(["2026-07-10", "2026-08-10", "2026-09-10"]);
    expect(booked.every((e) => toNumber(e.amount) === -50 && e.categoryId === f.categories.Software)).toBe(true);
    expect(await prisma.ledgerEntry.count({ where: { recurringRuleId: reminder.id } })).toBe(0);

    await processDueRules(prisma, new Date("2026-09-15T12:00:00Z"));
    expect(await prisma.ledgerEntry.count({ where: { recurringRuleId: auto.id } })).toBe(3);

    const paid = await markRulePaid(USER, reminder.id, prisma, { amount: 950 });
    expect(paid.rule.nextDueDate.toISOString().slice(0, 10)).toBe("2026-09-01");
    const rent = await prisma.ledgerEntry.findFirstOrThrow({ where: { recurringRuleId: reminder.id } });
    expect(toNumber(rent.amount)).toBe(-950);
    const skipped = await skipRuleOccurrence(USER, reminder.id, prisma);
    expect(skipped.nextDueDate.toISOString().slice(0, 10)).toBe("2026-10-01");
  });

  it("materializes recurring transfers as two-leg groups", async () => {
    const rule = await createRecurringRule(
      USER,
      { kind: "transfer", accountId: f.pjChecking, toAccountId: f.pfChecking, transferDirection: "profit_distribution", amount: 2000, description: "Pró-labore", frequency: "monthly", startDate: "2026-09-05", autoGenerate: true },
      prisma
    );
    await processDueRules(prisma, new Date("2026-09-06T12:00:00Z"));
    const groups = await prisma.transferGroup.findMany({ where: { userId: USER }, include: { legs: true } });
    expect(groups).toHaveLength(1);
    expect(groups[0].direction).toBe("profit_distribution");
    expect(groups[0].legs.map((l) => toNumber(l.amount)).sort((a, b) => a - b)).toEqual([-2000, 2000]);
    expect(groups[0].legs.every((l) => l.recurringRuleId === rule.id)).toBe(true);
  });

  it("books a foreign-currency rule at the rate in force unless it has an explicit one", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 0.2 } });
    const floating = await createRecurringRule(
      USER,
      { kind: "expense", accountId: f.pfChecking, amount: 10, currency: "USD", description: "GitHub", frequency: "monthly", startDate: "2026-09-01" },
      prisma
    );
    const fixed = await createRecurringRule(
      USER,
      { kind: "expense", accountId: f.pfChecking, amount: 10, currency: "USD", exchangeRate: 4, description: "Figma", frequency: "monthly", startDate: "2026-09-01" },
      prisma
    );
    expect(floating.exchangeRate).toBeNull();
    const a = await markRulePaid(USER, floating.id, prisma);
    const b = await markRulePaid(USER, fixed.id, prisma);
    const [entryA, entryB] = await Promise.all([a, b].map((r) => prisma.ledgerEntry.findUniqueOrThrow({ where: { id: r.entryIds[0] } })));
    expect(toNumber(entryA.amountBase)).toBe(-50);
    expect(toNumber(entryB.amountBase)).toBe(-40);
  });
});

describe("investments", () => {
  it("books a funded buy as a deposit transfer plus a cash leg, and keeps the average cost", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma);
    const buy = await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 100, pricePerUnit: 30, totalAmount: 3000, fees: 10, date: "2026-08-10", fundFromAccountId: f.pfChecking }, prisma);
    expect(buy.fundingGroupId).not.toBeNull();
    expect(buy.operation.fundingGroupId).toBe(buy.fundingGroupId);
    await recordOperation(USER, { holdingId: h.id, type: "sell", quantity: 50, pricePerUnit: 35, totalAmount: 1750, date: "2026-08-20" }, prisma);

    const holding = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: h.id } });
    expect(holding.currentQuantity).toBe(50);
    expect(holding.averageCost).toBeCloseTo(30, 5);

    const balances = await accountBalances(USER, prisma, [f.broker, f.pfChecking]);
    expect(balances.get(f.broker)).toBeCloseTo(1750, 2);
    expect(balances.get(f.pfChecking)).toBeCloseTo(-3010, 2);

    const summary = await portfolioSummary(USER, prisma);
    expect(summary).toMatchObject({ marketValue: 2000, cash: 1750, netWorth: 3750 });

    const c = await contributions(USER, 2026, prisma);
    expect(c.months[7]).toMatchObject({ deposits: 3010, net: 3010 });

    await deleteOperation(USER, buy.operation.id, prisma);
    expect(await prisma.ledgerEntry.count({ where: { id: buy.cashEntryId! } })).toBe(0);
  });

  it("suggests where to put new money without selling", async () => {
    const stocks = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", name: "S", currentPrice: 1 }, prisma);
    const fixed = await createHolding(USER, { accountId: f.broker, assetClass: "fixed_income", name: "CDB", currentPrice: 1 }, prisma);
    await recordOperation(USER, { holdingId: stocks.id, type: "buy", quantity: 8000, pricePerUnit: 1, totalAmount: 8000, date: "2026-08-01" }, prisma);
    await recordOperation(USER, { holdingId: fixed.id, type: "buy", quantity: 2000, pricePerUnit: 1, totalAmount: 2000, date: "2026-08-01" }, prisma);
    await setTargets(USER, [{ allocationClass: "br_stocks", targetPercent: 50 }, { allocationClass: "fixed_income", targetPercent: 50 }], prisma);
    const s = await rebalanceSuggestion(USER, 2000, "class", prisma);
    const by = Object.fromEntries(s.classes.map((c) => [c.allocationClass, c.amount]));
    expect(by).toEqual({ br_stocks: 0, fixed_income: 2000 });
    const assets = await rebalanceSuggestion(USER, 2000, "asset", prisma);
    expect(assets.assets).toEqual([expect.objectContaining({ holdingId: fixed.id, assetClass: "fixed_income", allocationClass: "fixed_income", amount: 2000 })]);
    await expect(setTargets(USER, [{ allocationClass: "br_stocks", targetPercent: 60 }], prisma)).rejects.toThrow(/100%/);
  });

  it("groups the allocation by the six classes, with the holding override winning", async () => {
    const usEtf = await createHolding(USER, { accountId: f.broker, assetClass: "etf", ticker: "VOO", name: "VOO", currency: "USD", currentPrice: 1 }, prisma);
    const brEtf = await createHolding(USER, { accountId: f.broker, assetClass: "etf", ticker: "BOVA11", name: "BOVA11", currentPrice: 1 }, prisma);
    const bdr = await createHolding(USER, { accountId: f.broker, assetClass: "bdr", ticker: "AAPL34", name: "Apple", currentPrice: 1 }, prisma);
    const fund = await createHolding(USER, { accountId: f.broker, assetClass: "savings", name: "Caixinha", allocationClass: "cash", currentPrice: 1 }, prisma);
    for (const [h, qty] of [[usEtf, 100], [brEtf, 200], [bdr, 300], [fund, 400]] as const) {
      await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: qty, pricePerUnit: 1, totalAmount: qty, date: "2026-08-01" }, prisma);
    }
    const summary = await portfolioSummary(USER, prisma);
    // No USD rate in the fixture, so USD converts at 1.
    expect(Object.fromEntries(summary.allocation.map((a) => [a.allocationClass, a.marketValue]))).toEqual({ international: 400, br_stocks: 200, cash: 400 });
  });

  it("maps asset-class targets onto allocation classes, summing collapsed classes", async () => {
    await createHolding(USER, { accountId: f.broker, assetClass: "etf", ticker: "VOO", name: "VOO", currency: "USD" }, prisma);
    const targets = await setTargets(
      USER,
      [
        { assetClass: "stocks", targetPercent: 30 },
        { assetClass: "fixed_income", targetPercent: 30 },
        { assetClass: "savings", targetPercent: 10 },
        // The user's ETFs trade in USD, so an ETF target is international.
        { assetClass: "etf", targetPercent: 20 },
        { assetClass: "bdr", targetPercent: 10 },
      ],
      prisma
    );
    expect(targets.map((t) => [t.allocationClass, t.targetPercent])).toEqual([
      ["fixed_income", 0.4],
      ["br_stocks", 0.3],
      ["international", 0.3],
    ]);
  });
});

describe("categories", () => {
  it("merges everything into the target and keeps a single rule per pattern", async () => {
    const extra = await prisma.category.create({ data: { userId: USER, name: "Mercado", type: "expense" } });
    await expense(f.pfChecking, 10, "2026-08-01", extra.id);
    await createBudget(USER, { categoryId: extra.id, amount: 100, effectiveFrom: "2026-08" }, prisma);
    await createRule(USER, { matchType: "contains", pattern: "zaffari", categoryId: extra.id }, prisma);
    await createRule(USER, { matchType: "contains", pattern: "carrefour", categoryId: extra.id }, prisma);
    await createRule(USER, { matchType: "contains", pattern: "zaffari", categoryId: f.categories.Groceries }, prisma).catch(() => undefined);

    const r = await mergeCategories(USER, extra.id, f.categories.Groceries, prisma);
    expect(r).toMatchObject({ transactionsMoved: 1, budgetsMoved: 1 });
    expect(await prisma.category.count({ where: { id: extra.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, categoryId: f.categories.Groceries } })).toBe(1);
    const rules = await prisma.categorizationRule.findMany({ where: { userId: USER } });
    expect(rules.every((x) => x.categoryId === f.categories.Groceries)).toBe(true);
  });

  it("protects categories in use and system categories", async () => {
    await expense(f.pfChecking, 10, "2026-08-01");
    await expect(deleteCategory(USER, f.categories.Groceries, undefined, prisma)).rejects.toThrow(/linked records/);
    await expect(updateCategory(USER, f.categories.Groceries, { type: "income" }, prisma)).rejects.toThrow(/Cannot change category type/);
    const sys = await prisma.category.create({ data: { userId: USER, name: "Other", type: "expense", systemKey: "other_system", isSystem: true, isDefault: true } });
    await expect(deleteCategory(USER, sys.id, f.categories.Software, prisma)).rejects.toThrow(/system category/);
    await deleteCategory(USER, f.categories.Groceries, f.categories.Software, prisma);
    expect(await prisma.ledgerEntry.count({ where: { userId: USER, categoryId: f.categories.Software } })).toBe(1);
  });
});
