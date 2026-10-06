import { describe, expect, it } from "vitest";
import { allocationBars, targetsPayload } from "../allocation";
import {
  alternativeContribution,
  clampEnd,
  compactAmount,
  contributionSeries,
  goalStatus,
  historyRows,
  originLabel,
  shiftMonth,
} from "../contributions-view";
import { irEstimate } from "../ir-estimate";
import { buyPreview, sellPreview, withheldTax } from "../op-preview";
import { filterOps, INCOME_12M_CONFIG, monthlyBars, monthsBetween, OPERATIONS_CONFIG, opsPeriodRange } from "../ops-view";
import { approxQuantityLabel, orderQuantity, ordersFromSuggestion, ordersPayload, parseAporteAmount } from "../rebalance-view";
import type { ContributionMonth, ContributionOrigin, Operation, RebalanceAsset } from "../types";

describe("allocationBars", () => {
  it("scales bars to 50%, places the target tick and flags differences from 3pp", () => {
    const bars = allocationBars([
      { allocationClass: "fixed_income", marketValue: 0, invested: 0, count: 1, share: 0.42, target: 0.4 },
      { allocationClass: "international", marketValue: 0, invested: 0, count: 1, share: 0.2, target: 0.25 },
      { allocationClass: "crypto", marketValue: 0, invested: 0, count: 1, share: 0.7, target: null },
    ]);
    expect(bars[0]).toMatchObject({ barWidth: 84, tickLeft: 80, highlight: false, diffLabel: "+2pp" });
    expect(bars[1]).toMatchObject({ highlight: true, diffLabel: "−5pp" });
    expect(bars[2]).toMatchObject({ barWidth: 100, tickLeft: 0, target: 0, diffLabel: "+70pp" });
  });

  it("builds the targets body and checks the sum", () => {
    const parse = (s: string) => Number(s.replace(",", "."));
    expect(targetsPayload({ fixed_income: "40", br_stocks: "20", fii: "10", international: "25", crypto: "5", cash: "" }, parse)).toMatchObject({ sum: 100, valid: true });
    const bad = targetsPayload({ fixed_income: "40,5", br_stocks: "20" }, parse);
    expect(bad).toMatchObject({ sum: 60.5, valid: false });
    expect(bad.targets).toEqual([
      { allocationClass: "fixed_income", targetPercent: 40.5 },
      { allocationClass: "br_stocks", targetPercent: 20 },
    ]);
  });
});

describe("op preview", () => {
  it("previews a buy with fees in the average price (mockup: 62 BOVA11 at 128,40)", () => {
    const p = buyPreview({ quantity: 921, averageCost: 114.24 }, { quantity: 62, price: 128.4, fees: 0 });
    expect(p.total).toBeCloseTo(7960.8, 6);
    expect(p.quantityAfter).toBe(983);
    expect(p.averageAfter).toBeCloseTo((921 * 114.24 + 7960.8) / 983, 9);
    expect(buyPreview(null, { quantity: 10, price: 10, fees: 5 })).toMatchObject({ total: 105, quantityBefore: 0, averageAfter: 10.5 });
  });

  it("previews a sale's result net of fees and flags an oversell", () => {
    const p = sellPreview({ quantity: 100, averageCost: 30 }, { quantity: 50, price: 40, fees: 10 });
    expect(p).toMatchObject({ total: 1990, gain: 490, averageCost: 30, oversell: false });
    expect(sellPreview({ quantity: 10, averageCost: 1 }, { quantity: 11, price: 1, fees: 0 }).oversell).toBe(true);
  });

  it("withholds 15% on JCP only", () => {
    expect(withheldTax("jcp", 412.8)).toBe(61.92);
    expect(withheldTax("dividend", 412.8)).toBe(0);
  });
});

describe("irEstimate", () => {
  const base = { currency: "BRL", gain: 1000, saleAmount: 5000, monthSales: 0 };
  it("exempts BR stock sales up to R$ 20 mil in the month", () => {
    expect(irEstimate({ ...base, assetClass: "stocks" })).toMatchObject({ tax: 0, exempt: true, reason: "stocksExempt" });
    expect(irEstimate({ ...base, assetClass: "stocks", monthSales: 16_000 })).toMatchObject({ tax: 150, reason: "stocks" });
  });
  it("taxes ETFs at 15% and FIIs at 20%", () => {
    expect(irEstimate({ ...base, assetClass: "etf" })).toMatchObject({ tax: 150, reason: "etf" });
    expect(irEstimate({ ...base, assetClass: "fii" })).toMatchObject({ tax: 200, reason: "fii" });
    expect(irEstimate({ ...base, assetClass: "international_etf", currency: "USD" })).toMatchObject({ tax: 150, reason: "foreign" });
  });
  it("pays nothing on a loss and leaves fixed income to the source", () => {
    expect(irEstimate({ ...base, assetClass: "etf", gain: -10 })).toMatchObject({ tax: 0, reason: "loss" });
    expect(irEstimate({ ...base, assetClass: "fixed_income" })).toMatchObject({ tax: null, reason: "withheld" });
  });
  it("exempts crypto up to R$ 35 mil", () => {
    expect(irEstimate({ ...base, assetClass: "crypto", monthSales: 29_000 })).toMatchObject({ exempt: true });
    expect(irEstimate({ ...base, assetClass: "crypto", monthSales: 31_000 })).toMatchObject({ tax: 150, reason: "crypto" });
  });
});

function op(over: Partial<Operation> & { id: string }): Operation {
  return {
    holdingId: "h1",
    ticker: "ITUB4",
    name: "Itaú",
    assetClass: "stocks",
    allocationClass: "br_stocks",
    accountId: "xp",
    accountName: "XP",
    entityId: "pf",
    currency: "BRL",
    type: "dividend",
    incomeType: "dividend",
    quantity: null,
    pricePerUnit: null,
    totalAmount: 100,
    fees: 0,
    taxWithheld: 0,
    cashAmount: 100,
    date: "2026-09-10",
    notes: null,
    externalId: null,
    cashEntryId: null,
    creditToAccountId: null,
    fundingGroupId: null,
    ...over,
  } as Operation;
}

describe("ops views", () => {
  it("resolves periods like the ledger engine", () => {
    expect(opsPeriodRange({ preset: "last_12m", offset: 0 }, "2026-09-22")).toEqual({ from: "2025-10-01", to: "2026-09-30" });
    expect(opsPeriodRange({ preset: "all" }, "2026-09-22")).toBeNull();
    // Same rule as the ledger engine: this year stops at the current month, a past year is whole.
    expect(opsPeriodRange({ preset: "ytd", offset: 0 }, "2026-09-22")).toEqual({ from: "2026-01-01", to: "2026-09-30" });
    expect(opsPeriodRange({ preset: "ytd", offset: -1 }, "2026-09-22")).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(monthsBetween("2025-11-01", "2026-02-28")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
  });

  it("keeps the income of the last 12 months and charts it net of tax, zero-filled", () => {
    const ops = [
      op({ id: "a", date: "2026-09-10", totalAmount: 100, taxWithheld: 15 }),
      op({ id: "b", date: "2026-08-01", type: "yield_payment", currency: "USD", totalAmount: 10 }),
      op({ id: "c", date: "2025-09-30", totalAmount: 50 }),
      op({ id: "d", date: "2026-09-11", type: "buy", totalAmount: 1000 }),
    ];
    const income = filterOps(ops, INCOME_12M_CONFIG, "2026-09-22");
    expect(income.map((o) => o.id)).toEqual(["a", "b"]);
    const bars = monthlyBars(income, INCOME_12M_CONFIG, "2026-09-22", (c) => (c === "USD" ? 5 : 1));
    expect(bars.months).toHaveLength(12);
    expect(bars.rows.at(-1)).toEqual({ month: "2026-09", total: 85 });
    expect(bars.rows.at(-2)).toEqual({ month: "2026-08", total: 50 });
    expect(bars.total).toBe(135);
    expect(filterOps(ops, OPERATIONS_CONFIG, "2026-09-22").map((o) => o.id)).toEqual(["d", "a", "b", "c"]);
  });
});

function asset(over: Partial<RebalanceAsset>): RebalanceAsset {
  return {
    kind: "holding",
    holdingId: "h1",
    ticker: "BOVA11",
    name: "iShares",
    assetClass: "etf",
    allocationClass: "br_stocks",
    accountId: "xp",
    accountName: "XP",
    entityId: "pf",
    currency: "BRL",
    price: 128.4,
    amount: 5000,
    approxQuantity: 38.94,
    ...over,
  } as RebalanceAsset;
}

describe("rebalance view", () => {
  const fmt = { number: (v: number) => String(v).replace(".", ",") };
  it("labels the approximate quantity", () => {
    expect(approxQuantityLabel(asset({}), fmt, (n) => `${n} cotas`)).toBe("39 cotas");
    expect(approxQuantityLabel(asset({ assetClass: "crypto", ticker: "BTC", approxQuantity: 0.0002 }), fmt, (n) => `${n} cotas`)).toBe("0,0002 BTC");
    expect(approxQuantityLabel(asset({ approxQuantity: null }), fmt, (n) => `${n} cotas`)).toBeNull();
    expect(orderQuantity(asset({ approxQuantity: 0.4 }))).toBeNull();
  });

  it("turns the suggestion into orders: whole units, amounts for unpriced assets, no new/cash/unquoted rows", () => {
    const orders = ordersFromSuggestion(
      [
        asset({}),
        asset({ holdingId: "cdb", ticker: null, name: "CDB", assetClass: "fixed_income", allocationClass: "fixed_income", price: null, approxQuantity: null, amount: 3000 }),
        asset({ holdingId: "voo", ticker: "VOO", currency: "USD", price: 500, approxQuantity: 1.5, amount: 4000 }),
        asset({ kind: "new", holdingId: null, amount: 1000 }),
        asset({ holdingId: "itub", ticker: "ITUB4", assetClass: "stocks", price: null, approxQuantity: null, amount: 700 }),
        asset({ kind: "cash", holdingId: null, allocationClass: "cash", amount: 500 }),
      ],
      (c) => (c === "USD" ? 5 : 1),
    );
    expect(orders.map((o) => [o.holdingId, o.quantity, o.amount])).toEqual([
      ["h1", 38, 4879.2],
      ["cdb", null, 3000],
      ["voo", 1, 500],
    ]);
    expect(ordersPayload(orders, "2026-09-22", null).orders).toEqual([
      { holdingId: "h1", quantity: 38, price: 128.4 },
      { holdingId: "cdb", amount: 3000 },
      { holdingId: "voo", quantity: 1, price: 500 },
    ]);
  });

  it("parses the amount typed in whole units", () => {
    expect(parseAporteAmount("15000")).toBe(15000);
    expect(parseAporteAmount("15.000")).toBe(15000);
    expect(parseAporteAmount("15.000,50")).toBe(15000);
    expect(parseAporteAmount("abc")).toBe(0);
  });
});

function origin(over: Partial<ContributionOrigin>): ContributionOrigin {
  return {
    transferGroupId: "g1",
    entryId: "e1",
    date: "2026-09-05",
    amount: 15000,
    direction: "investment_deposit",
    description: null,
    defaultDescription: false,
    brokerAccountId: "xp",
    brokerAccountName: "XP",
    brokerEntityName: "PF",
    counterpartAccountName: "Nubank",
    counterpartEntityName: "PF",
    sourceEntityName: null,
    sourceTransferGroupId: null,
    sourceDescription: null,
    ...over,
  } as ContributionOrigin;
}

function month(period: string, net: number, origins: ContributionOrigin[] = [], byAllocationClass: ContributionMonth["byAllocationClass"] = {}): ContributionMonth {
  return { period, year: Number(period.slice(0, 4)), month: Number(period.slice(5)), deposits: Math.max(net, 0), withdrawals: Math.max(-net, 0), net, byAllocationClass, byAssetClass: {}, origins };
}

describe("contributions view", () => {
  it("navigates months across the year boundary and clamps the end", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2025-12", 1)).toBe("2026-01");
    expect(shiftMonth("2026-09", -11)).toBe("2025-10");
    expect(clampEnd("2027-01", "2026-09")).toBe("2026-09");
    expect(clampEnd("bad", "2026-09")).toBe("2026-09");
    expect(clampEnd("2026-03", "2026-09")).toBe("2026-03");
  });

  it("rates a month against the goal with a 2% band", () => {
    expect(goalStatus(15000, 15000)).toBe("ok");
    expect(goalStatus(16000, 15000)).toBe("above");
    expect(goalStatus(14000, 15000)).toBe("below");
    expect(goalStatus(14000, null)).toBeNull();
  });

  it("describes the origin by the transfer's description, else source → broker", () => {
    expect(originLabel([origin({ description: "Distribuição LTDA → PF" })])).toBe("Distribuição LTDA → PF");
    expect(originLabel([origin({ sourceEntityName: "LTDA" })])).toBe("LTDA → PF");
    expect(originLabel([origin({ description: "Salário PF" }), origin({ description: "Bônus", amount: 20000 })])).toBe("Bônus + Salário PF");
  });

  it("never shows the default transfer text: the source transfer's description, else entity → entity, else origin account → broker", () => {
    const auto = { description: "Aporte em investimento: Nubank → XP", defaultDescription: true };
    expect(originLabel([origin(auto)])).toBe("Nubank → XP");
    expect(originLabel([origin({ ...auto, sourceEntityName: "LTDA", sourceDescription: "Distribuição LTDA → PF" })])).toBe("Distribuição LTDA → PF");
    expect(originLabel([origin({ ...auto, sourceEntityName: "LTDA" })])).toBe("LTDA → PF");
    // A resgate from a PJ broker into a PF account goes from the broker's entity to the other one.
    expect(
      originLabel([origin({ description: "Resgate de investimento: BTG → Conta principal", defaultDescription: true, amount: -400, brokerEntityName: "LTDA", sourceEntityName: "PF" })])
    ).toBe("LTDA → PF");
    expect(originLabel([origin({ description: "Resgate de investimento: XP → Nubank", defaultDescription: true, amount: -500 })])).toBe("XP → Nubank");
    expect(originLabel([origin({ ...auto, counterpartAccountName: null })])).toBe("XP");
  });

  it("lists months with aportes newest first, with every transfer for the drill", () => {
    const rows = historyRows(
      [month("2026-08", 16000, [origin({ transferGroupId: "a", sourceTransferGroupId: "s" })]), month("2026-09", 15000, [origin({ transferGroupId: "b" })]), month("2026-07", 0)],
      15000,
    );
    expect(rows.map((r) => [r.period, r.status, r.transferGroupIds])).toEqual([
      ["2026-09", "ok", ["b"]],
      ["2026-08", "above", ["a", "s"]],
    ]);
  });

  it("stacks the classes with money in the window", () => {
    const s = contributionSeries([month("2026-08", 1, [], { br_stocks: 3000, cash: 0 }), month("2026-09", 1, [], { fixed_income: 2000 })]);
    expect(s.classes).toEqual(["fixed_income", "br_stocks"]);
    expect(s.rows[0].values).toEqual({ fixed_income: 0, br_stocks: 3000 });
  });

  it("suggests the alternative contribution and compacts amounts", () => {
    expect(alternativeContribution(15000)).toBe(18000);
    expect(alternativeContribution(null)).toBeNull();
    const fmt = (n: number, d: { min: number; max: number }) => n.toFixed(d.max).replace(".", ",");
    expect(compactAmount(4_200_000, fmt)).toEqual({ value: "4,2", unit: "mi" });
    expect(compactAmount(38_400, fmt)).toEqual({ value: "38", unit: "mil" });
    expect(compactAmount(950, fmt)).toEqual({ value: "950", unit: null });
    expect(compactAmount(1_250_000_000, fmt)).toEqual({ value: "1,3", unit: "bi" });
    expect(compactAmount(-4_200_000, fmt)).toEqual({ value: "-4,2", unit: "mi" });
  });

  it("keeps the goal band edges inside 'na meta' and ignores a zero goal", () => {
    expect(goalStatus(15300, 15000)).toBe("ok");
    expect(goalStatus(14700, 15000)).toBe("ok");
    expect(goalStatus(15301, 15000)).toBe("above");
    expect(goalStatus(14699, 15000)).toBe("below");
    expect(goalStatus(500, 0)).toBeNull();
  });
});
