import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { recordAporte } from "../aporte";
import { proventos12m } from "../proventos";
import { contributions, isDefaultTransferDescription } from "../contributions";
import { createHolding, moveBrokerageCash, portfolioSummary, recordOperation } from "../portfolio";

const USER = "test-user-investments-contributions-001";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const transfer = (fromAccountId: string, toAccountId: string, amount: number, date: string, description?: string) =>
  createEntry(USER, { kind: "transfer", fromAccountId, toAccountId, amount, date, description }, prisma);

/**
 * Nov/25: salary 10k, aporte 3k. Dec/25: profit distribution 5k into PF,
 * aporte 4k, PETR4 bought for 2,010 (fees included), groceries 300.
 * Jan/26: resgate 500, aporte of 2k straight from the PJ account (a profit
 * distribution PJ → PF plus the deposit, in one batch).
 */
async function seed() {
  await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 10000, date: "2025-11-05", description: "Salário", categoryId: f.categories.Salary }, prisma);
  await transfer(f.pfChecking, f.broker, 3000, "2025-11-10", "Aporte novembro");
  await transfer(f.pjChecking, f.pfChecking, 5000, "2025-12-05", "Distribuição de lucros");
  await transfer(f.pfChecking, f.broker, 4000, "2025-12-10");
  await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 300, date: "2025-12-11", description: "Mercado", categoryId: f.categories.Groceries }, prisma);
  const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
  await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 50, pricePerUnit: 40, totalAmount: 2000, fees: 10, date: "2025-12-12" }, prisma);
  await transfer(f.broker, f.pfChecking, 500, "2026-01-10");
  return recordAporte(USER, { fromAccountId: f.pjChecking, brokerAccountId: f.broker, amount: 2000, date: "2026-01-15" }, prisma);
}

describe("contributions", () => {
  it("covers a trailing window across the year boundary, with buys by class, origins and the PF savings rate", async () => {
    const aporte = await seed();
    const c = await contributions(USER, prisma, { months: 3, end: "2026-01" });
    expect(c).toMatchObject({ from: "2025-11", to: "2026-01", totalNet: 8500 });
    expect(c).not.toHaveProperty("year");
    expect(c.averageMonthly).toBeCloseTo(8500 / 3, 2);
    expect(c.months.map((m) => [m.period, m.year, m.month, m.deposits, m.withdrawals, m.net])).toEqual([
      ["2025-11", 2025, 11, 3000, 0, 3000],
      ["2025-12", 2025, 12, 4000, 0, 4000],
      ["2026-01", 2026, 1, 2000, 500, 1500],
    ]);
    // Compras are the buys, not the unspent aporte. Nov bought nothing. Dec bought 2,010 of BR stocks.
    expect(c.months[0].byAllocationClass).toEqual({});
    expect(c.months[1].byAllocationClass).toEqual({ br_stocks: 2010 });
    expect(c.months[1].byAssetClass).toEqual({ stocks: 2010 });

    expect(c.months[0].origins).toEqual([
      expect.objectContaining({ amount: 3000, direction: "investment_deposit", description: "Aporte novembro", defaultDescription: false, brokerAccountName: "XP", counterpartAccountName: "Conta principal", counterpartEntityName: "PF", sourceEntityName: null }),
    ]);
    // December's aporte has the text a transfer gets when none is typed: the screen shows its origin instead.
    expect(c.months[1].origins[0]).toMatchObject({ description: "Aporte em investimento: Conta principal → XP", defaultDescription: true });
    // January, newest first: the cross-entity aporte names the PJ as the source, the resgate is negative.
    const [jan15, jan10] = c.months[2].origins;
    expect(jan15).toMatchObject({ date: "2026-01-15", amount: 2000, counterpartEntityName: "PF", sourceEntityName: "Kodama LTDA" });
    expect(aporte.transferGroupIds).toContain(jan15.transferGroupId);
    expect(aporte.transferGroupIds).toContain(jan15.sourceTransferGroupId);
    expect(jan10).toMatchObject({ date: "2026-01-10", amount: -500, direction: "investment_withdrawal", sourceEntityName: null, defaultDescription: true });
    // The profit distribution that fed it kept its default text, so there is no source description to show.
    expect(jan15).toMatchObject({ defaultDescription: true, sourceDescription: null });
    await prisma.transferGroup.update({ where: { id: jan15.sourceTransferGroupId! }, data: { description: "Distribuição LTDA → PF" } });
    const typed = await contributions(USER, prisma, { months: 1, end: "2026-01" });
    expect(typed.months[0].origins[0]).toMatchObject({ sourceDescription: "Distribuição LTDA → PF" });

    // PF aportes 8.5k over PF Entradas: salary 10k + the two profit distributions (5k and 2k). Groceries,
    // the aportes themselves and the buy's cash leg are not income.
    expect(c.savingsRate).toEqual({ aportes: 8500, income: 17000, rate: 0.5 });
  });

  it("keeps the calendar-year mode and filters by scope (the savings rate stays PF)", async () => {
    await seed();
    const y = await contributions(USER, prisma, { year: 2025 });
    expect(y).toMatchObject({ year: 2025, from: "2025-01", to: "2025-12", totalNet: 7000 });
    expect(y.months).toHaveLength(12);
    expect(y.months[10]).toMatchObject({ month: 11, net: 3000 });
    expect(y.months[0]).toMatchObject({ month: 1, net: 0, byAllocationClass: {}, origins: [] });

    const pj = await contributions(USER, prisma, { months: 3, end: "2026-01", entityIds: [f.pjId] });
    expect(pj.months.map((m) => m.net)).toEqual([0, 0, 0]);
    expect(pj.savingsRate.rate).toBe(0.5);
  });

  it("names the entity a resgate across entities went on to, not the broker's own", async () => {
    const btg = (await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "BTG", currency: "BRL" } })).id;
    await moveBrokerageCash(USER, { accountId: btg, direction: "deposit", amount: 1000, date: "2026-04-01", counterpartAccountId: f.pjChecking }, prisma);
    const resgate = await moveBrokerageCash(USER, { accountId: btg, direction: "withdraw", amount: 400, date: "2026-04-02", counterpartAccountId: f.pfChecking }, prisma);
    const c = await contributions(USER, prisma, { months: 1, end: "2026-04", entityIds: [f.pjId] });
    const out = c.months[0].origins.find((o) => o.amount < 0)!;
    expect(out).toMatchObject({ amount: -400, brokerEntityName: "Kodama LTDA", sourceEntityName: "PF", sourceTransferGroupId: resgate.transferGroupIds[1] });
  });

  it("counts an unlinked checking investment as an aporte, and skips one a broker leg already matches", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 800, date: "2026-10-01", description: "Caixinha" }, prisma, { kind: "investment" });
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: -200, date: "2026-10-02", description: "Resgate caixinha" }, prisma, { kind: "investment" });
    await transfer(f.pfChecking, f.broker, 500, "2026-10-03", "Aporte que já está na corretora");
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 500, date: "2026-10-04", description: "Duplicata" }, prisma, { kind: "investment" });
    const c = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    expect(c.months[0]).toMatchObject({ deposits: 1300, withdrawals: 200, net: 1100 });
    expect(c.months[0].origins.map((o) => o.amount).sort((a, b) => b - a)).toEqual([800, 500, -200]);
    expect(c.months[0].origins.find((o) => o.amount === 800)).toMatchObject({ standalone: true, description: "Caixinha" });
    expect(c.savingsRate.aportes).toBe(1100);
    // The caixinha is not a broker, so Carteira counts only the R$500 that reached XP.
    const summary = await portfolioSummary(USER, prisma);
    expect(summary.contributed).toBe(500);
    expect(summary.netWorth).toBe(500);
    expect(summary.result).toBe(0);
  });

  it("matches a bank investment to the closest brokerage leg", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 100, date: "2026-10-04", description: "Perto" }, prisma, { kind: "investment" });
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 100, date: "2026-10-06", description: "Longe" }, prisma, { kind: "investment" });
    await transfer(f.pfChecking, f.broker, 100, "2026-10-01", "Corretora distante");
    await transfer(f.pfChecking, f.broker, 100, "2026-10-06", "Corretora no dia");
    const c = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    // Oct 4 is closer to Oct 6 than to Oct 1, so it takes that leg and Oct 6's bank row is the aporte.
    const standalone = c.months[0].origins.filter((o) => o.standalone);
    expect(standalone.map((o) => o.description)).toEqual(["Longe"]);
  });

  it("leaves a no-cash opening lot out of purchases", async () => {
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "crypto", ticker: "BTC", name: "Bitcoin" }, prisma);
    await prisma.investmentOperation.create({
      data: { holdingId: h.id, type: "buy", quantity: 0.3667, pricePerUnit: 60000, totalAmount: 22002, fees: 0, date: new Date("2026-03-02T12:00:00Z") },
    });
    const c = await contributions(USER, prisma, { months: 1, end: "2026-03" });
    expect(c.months[0].byAllocationClass).toEqual({});
    expect(c.months[0].byAssetClass).toEqual({});
  });

  it("converts a USD dividend at the rate on its date", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "US Dollar", symbol: "$", manualRate: 0.2 } });
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "international_etf", ticker: "VUAA", name: "VUAA", currency: "USD" }, prisma);
    await prisma.investmentOperation.create({
      data: { holdingId: h.id, type: "dividend", quantity: 1, totalAmount: 10, taxWithheld: 0, date: new Date("2026-08-12T12:00:00Z") },
    });
    const proventos = await proventos12m(USER, prisma);
    expect(proventos.total).toBeCloseTo(51.29, 2);
    expect(proventos.total).not.toBeCloseTo(50, 2);
  });

  it("counts a purchase paid with provento cash once, on the owner's scope, and not the provento itself", async () => {
    const fii = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "HGLG11", name: "CSHG Logística" }, prisma);
    await recordOperation(USER, { holdingId: fii.id, type: "dividend", incomeType: "fii_income", totalAmount: 2400, date: "2026-09-15" }, prisma);
    // Received in September and not yet spent: the provento is not an aporte.
    const september = await contributions(USER, prisma, { months: 1, end: "2026-09" });
    expect(september.months[0]).toMatchObject({ deposits: 0, withdrawals: 0, net: 0, origins: [] });

    await transfer(f.pfChecking, f.broker, 25400, "2026-10-10", "Aporte outubro");
    await recordOperation(USER, { holdingId: fii.id, type: "buy", quantity: 24, pricePerUnit: 100, totalAmount: 2400, fees: 0, date: "2026-10-27" }, prisma);
    // The provento cash is gone, so a second buy of the same broker is not another aporte.
    await recordOperation(USER, { holdingId: fii.id, type: "buy", quantity: 10, pricePerUnit: 100, totalAmount: 1000, fees: 0, date: "2026-10-28" }, prisma);

    const pjBroker = (await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "BTG", currency: "BRL" } })).id;
    const pjFii = await createHolding(USER, { accountId: pjBroker, assetClass: "fii", ticker: "KNRI11", name: "Kinea" }, prisma);
    await recordOperation(USER, { holdingId: pjFii.id, type: "dividend", incomeType: "fii_income", totalAmount: 800, date: "2026-10-06" }, prisma);
    await recordOperation(USER, { holdingId: pjFii.id, type: "buy", quantity: 8, pricePerUnit: 100, totalAmount: 800, fees: 0, date: "2026-10-20" }, prisma);

    const all = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    expect(all.months[0]).toMatchObject({ deposits: 28600, withdrawals: 0, net: 28600 });
    expect(all.months[0].byAllocationClass.fii).toBe(4200);
    expect(all.months[0].origins.filter((o) => o.brokerageCash).map((o) => [o.description, o.amount]).sort()).toEqual([
      ["HGLG11", 2400],
      ["KNRI11", 800],
    ]);
    expect(all.months[0].origins.find((o) => o.amount === 25400)).toMatchObject({ brokerageCash: false, description: "Aporte outubro" });

    const pf = await contributions(USER, prisma, { months: 1, end: "2026-10", entityIds: [f.pfId] });
    const pj = await contributions(USER, prisma, { months: 1, end: "2026-10", entityIds: [f.pjId] });
    expect(pf.months[0]).toMatchObject({ deposits: 27800, withdrawals: 0, net: 27800 });
    expect(pf.months[0].origins.filter((o) => o.brokerageCash).map((o) => o.description)).toEqual(["HGLG11"]);
    expect(pj.months[0]).toMatchObject({ deposits: 800, withdrawals: 0, net: 800 });
    expect(pj.months[0].origins.filter((o) => o.brokerageCash).map((o) => o.description)).toEqual(["KNRI11"]);
    expect(pf.months[0].net + pj.months[0].net).toBe(all.months[0].net);
    // The savings rate stays PF on every scope: the R$25.4k transfer plus the R$2.4k purchase. The provento is not income.
    expect(pf.savingsRate).toEqual({ aportes: 27800, income: 0, rate: null });
    expect(pj.savingsRate).toEqual(pf.savingsRate);
    expect(all.savingsRate).toEqual(pf.savingsRate);
  });

  it("does not count a transfer and the buy it paid for twice, and a withdrawal still reduces the net", async () => {
    const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 50, pricePerUnit: 40, totalAmount: 2000, fees: 10, date: "2026-10-03", fundFromAccountId: f.pfChecking }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "dividend", incomeType: "jcp", totalAmount: 1000, taxWithheld: 150, date: "2026-10-04" }, prisma);
    const fii = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "HGLG11", name: "CSHG Logística" }, prisma);
    // JCP lands net of tax (850). The funded PETR4 buy must not consume it.
    await recordOperation(USER, { holdingId: fii.id, type: "buy", quantity: 8, pricePerUnit: 100, totalAmount: 850, fees: 0, date: "2026-10-05" }, prisma);
    await transfer(f.broker, f.pfChecking, 200, "2026-10-06");
    const c = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    expect(c.months[0]).toMatchObject({ deposits: 2860, withdrawals: 200, net: 2660 });
    expect(c.months[0].origins.filter((o) => o.brokerageCash)).toEqual([expect.objectContaining({ description: "HGLG11", amount: 850 })]);
  });

  it("does not treat a dividend paid into the bank as cash already at the broker", async () => {
    const fii = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "HGLG11", name: "CSHG Logística" }, prisma);
    await recordOperation(
      USER,
      { holdingId: fii.id, type: "dividend", incomeType: "fii_income", totalAmount: 400, date: "2026-10-01", creditToAccountId: f.pfChecking },
      prisma,
    );
    await transfer(f.pfChecking, f.broker, 400, "2026-10-02", "Levou o rendimento ao XP");
    await recordOperation(USER, { holdingId: fii.id, type: "buy", quantity: 4, pricePerUnit: 100, totalAmount: 400, fees: 0, date: "2026-10-03" }, prisma);
    const c = await contributions(USER, prisma, { months: 1, end: "2026-10" });
    expect(c.months[0]).toMatchObject({ deposits: 400, withdrawals: 0, net: 400 });
    expect(c.months[0].origins.filter((o) => o.brokerageCash)).toEqual([]);
  });

  it("counts Proventos income booked on the broker, and ignores a sale that is bought again", async () => {
    const category = await prisma.category.create({ data: { userId: USER, name: "Proventos", type: "income" } });
    await createEntry(USER, { kind: "income", accountId: f.broker, amount: 300, date: "2026-11-02", description: "Rendimento em conta", categoryId: category.id }, prisma);
    const fii = await createHolding(USER, { accountId: f.broker, assetClass: "fii", ticker: "MXRF11", name: "Maxi Renda" }, prisma);
    await recordOperation(USER, { holdingId: fii.id, type: "buy", quantity: 30, pricePerUnit: 10, totalAmount: 300, fees: 0, date: "2026-11-10" }, prisma);

    const petr = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras" }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 10, pricePerUnit: 100, totalAmount: 1000, fees: 0, date: "2026-11-03", fundFromAccountId: f.pfChecking }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "sell", quantity: 10, pricePerUnit: 100, totalAmount: 1000, fees: 0, date: "2026-11-12" }, prisma);
    await recordOperation(USER, { holdingId: petr.id, type: "buy", quantity: 10, pricePerUnit: 100, totalAmount: 1000, fees: 0, date: "2026-11-13" }, prisma);

    const c = await contributions(USER, prisma, { months: 1, end: "2026-11" });
    // The R$1,000 round trip is the original transfer only. The R$300 buy is the ledger provento.
    expect(c.months[0]).toMatchObject({ deposits: 1300, withdrawals: 0, net: 1300 });
    expect(c.months[0].origins.filter((o) => o.brokerageCash).map((o) => [o.description, o.amount])).toEqual([["MXRF11", 300]]);
  });

  it("has no savings rate without PF income", async () => {
    await transfer(f.pfChecking, f.broker, 1000, "2026-03-02");
    const c = await contributions(USER, prisma, { months: 1, end: "2026-03" });
    expect(c.savingsRate).toEqual({ aportes: 1000, income: 0, rate: null });
  });
});

describe("isDefaultTransferDescription", () => {
  it("recognizes the default text in any language, whatever the account names, and nothing typed", () => {
    expect(isDefaultTransferDescription("Aporte em investimento: Nubank → XP", "investment_deposit")).toBe(true);
    expect(isDefaultTransferDescription("Investment deposit: Old name → XP", "investment_deposit")).toBe(true);
    expect(isDefaultTransferDescription("Distribuição de lucros: Conta principal → Conta principal", "profit_distribution")).toBe(true);
    expect(isDefaultTransferDescription(null, "investment_deposit")).toBe(true);
    expect(isDefaultTransferDescription("Salário PF", "investment_deposit")).toBe(false);
    expect(isDefaultTransferDescription("Distribuição LTDA → PF", "profit_distribution")).toBe(false);
    // Another direction's text is something the user typed (or moved), not this transfer's default.
    expect(isDefaultTransferDescription("Resgate de investimento: XP → Nubank", "investment_deposit")).toBe(false);
  });
});
