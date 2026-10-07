import { describe, expect, it } from "vitest";
import { addMonths, buildTimeline, monthEnd, parsePeriod, periodLabel, periodOf, periodRange, type TimelineHolding, type TimelineInput, type TimelineOperation } from "../portfolio-timeline";

const d = (s: string) => new Date(`${s}T12:00:00Z`);
const op = (id: string, date: string, fields: Partial<TimelineOperation> & Pick<TimelineOperation, "type">): TimelineOperation => ({
  id,
  date: d(date),
  quantity: null,
  pricePerUnit: null,
  totalAmount: 0,
  fees: 0,
  cash: "broker",
  outsideAmountBase: 0,
  ...fields,
});
const holding = (fields: Partial<TimelineHolding> & Pick<TimelineHolding, "id" | "operations">): TimelineHolding => ({
  entityId: "pf",
  assetClass: "stocks",
  allocationClass: "br_stocks",
  currency: "BRL",
  createdAt: d("2025-01-01"),
  currentQuantity: 0,
  currentPrice: null,
  totalInvested: 0,
  ...fields,
});
const input = (over: Partial<TimelineInput>): TimelineInput => ({
  accounts: [{ id: "xp", entityId: "pf", currency: "BRL", initialBalance: 0, openedAt: d("2025-01-01") }],
  entries: [],
  holdings: [],
  rateFor: (c) => (c === "USD" ? 5 : 1),
  ...over,
});

describe("periods", () => {
  it("moves across years", () => {
    expect(addMonths(202511, 2)).toBe(202601);
    expect(addMonths(202601, -1)).toBe(202512);
    expect(addMonths(202601, -13)).toBe(202412);
    expect(periodRange(202511, 202602)).toEqual([202511, 202512, 202601, 202602]);
    expect(periodLabel(202601)).toBe("2026-01");
    expect(parsePeriod("2026-01")).toBe(202601);
    expect(parsePeriod("2026-13")).toBeNull();
    expect(periodOf(d("2026-03-31"))).toBe(202603);
    // A date stored at noon UTC on the last day belongs to its month.
    expect(d("2026-01-31") < monthEnd(202601)).toBe(true);
  });
});

describe("buildTimeline", () => {
  it("rebuilds cash, cost basis, contributions and the monthly flow from aportes and a buy", () => {
    const t = buildTimeline(
      input({
        entries: [
          { accountId: "xp", date: d("2026-01-10"), amount: 1000, amountBase: 1000, isTransfer: true },
          { accountId: "xp", date: d("2026-01-15"), amount: -900, amountBase: -900, isTransfer: false },
          { accountId: "xp", date: d("2026-02-05"), amount: 500, amountBase: 500, isTransfer: true },
          { accountId: "xp", date: d("2026-03-05"), amount: -200, amountBase: -200, isTransfer: true },
        ],
        holdings: [holding({ id: "petr", currentQuantity: 30, currentPrice: 40, operations: [op("b1", "2026-01-15", { type: "buy", quantity: 30, pricePerUnit: 29.9, totalAmount: 897, fees: 3 })] })],
      })
    );
    expect(t.entityIds).toEqual(["pf"]);
    expect(t.firstPeriod("pf")).toBe(202601);

    const jan = t.state("pf", 202601);
    expect(jan).toMatchObject({ cash: 100, costBasis: 900, contributed: 1000, netFlow: 1000 });
    expect(t.value(jan, "cost").marketValue).toBe(900);
    expect(t.value(jan, "price")).toMatchObject({ marketValue: 1200, byClass: { br_stocks: 1200, cash: 100 } });

    expect(t.state("pf", 202602)).toMatchObject({ cash: 600, contributed: 1500, netFlow: 500 });
    // A resgate is a negative flow and lowers "Total aportado".
    expect(t.state("pf", 202603)).toMatchObject({ cash: 400, contributed: 1300, netFlow: -200 });
    // Before the first activity there is nothing.
    expect(t.state("pf", 202512)).toMatchObject({ cash: 0, costBasis: 0, contributed: 0, netFlow: 0, positions: [] });
  });

  it("counts the initial balance from the account's opening, and positions registered without cash", () => {
    const t = buildTimeline(
      input({
        accounts: [{ id: "ibkr", entityId: "llc", currency: "USD", initialBalance: 100, openedAt: d("2025-06-01") }],
        holdings: [
          // Bought with no cash leg: its cost came in from outside.
          holding({ id: "voo", entityId: "llc", currency: "USD", assetClass: "international_etf", allocationClass: "international", operations: [op("b", "2025-07-02", { type: "buy", quantity: 2, pricePerUnit: 50, totalAmount: 100, cash: "none" })] }),
          // Entered directly, no operations: its cost basis came in when created.
          holding({ id: "old", entityId: "llc", currency: "USD", createdAt: d("2025-08-20"), currentQuantity: 10, totalInvested: 40, currentPrice: 5, operations: [] }),
        ],
      })
    );
    expect(t.state("llc", 202505)).toMatchObject({ cash: 0, contributed: 0 });
    // USD at 5: the 100 initial balance is 500.
    expect(t.state("llc", 202506)).toMatchObject({ cash: 500, contributed: 500, netFlow: 500 });
    expect(t.state("llc", 202507)).toMatchObject({ cash: 500, costBasis: 500, contributed: 1000, netFlow: 500 });
    const aug = t.state("llc", 202508);
    expect(aug).toMatchObject({ costBasis: 700, contributed: 1200, netFlow: 200 });
    // VOO has no price, so it counts at cost (500); OLD is 10 x US$ 5 x 5.
    expect(t.value(aug, "price").marketValue).toBe(750);
  });

  it("treats income credited to a bank as money leaving, but not as a smaller aporte", () => {
    const t = buildTimeline(
      input({
        entries: [{ accountId: "xp", date: d("2026-01-02"), amount: 1000, amountBase: 1000, isTransfer: true }],
        holdings: [
          holding({
            id: "fii",
            assetClass: "fii",
            allocationClass: "fii",
            operations: [
              op("b", "2026-01-02", { type: "buy", quantity: 10, pricePerUnit: 100, totalAmount: 1000 }),
              op("d", "2026-02-15", { type: "dividend", totalAmount: 80, cash: "outside", outsideAmountBase: 80 }),
            ],
          }),
        ],
      })
    );
    expect(t.state("pf", 202602)).toMatchObject({ contributed: 1000, netFlow: -80 });
  });

  it("takes a sale without cash leg out at its net proceeds and closes the position", () => {
    const t = buildTimeline(
      input({
        holdings: [
          holding({
            id: "h",
            operations: [
              op("b", "2026-01-02", { type: "buy", quantity: 10, pricePerUnit: 10, totalAmount: 100, cash: "none" }),
              op("s", "2026-02-02", { type: "sell", quantity: 10, pricePerUnit: 15, totalAmount: 150, fees: 1, cash: "none" }),
            ],
          }),
        ],
      })
    );
    expect(t.state("pf", 202601)).toMatchObject({ contributed: 100, costBasis: 100 });
    expect(t.state("pf", 202602)).toMatchObject({ contributed: -49, netFlow: -149, costBasis: 0, positions: [] });
  });

  it("takes what a deactivated holding still held out at cost on the day it was removed", () => {
    const t = buildTimeline(
      input({
        entries: [
          { accountId: "xp", date: d("2026-01-02"), amount: 1000, amountBase: 1000, isTransfer: true },
          { accountId: "xp", date: d("2026-01-05"), amount: -500, amountBase: -500, isTransfer: false },
          { accountId: "xp", date: d("2026-02-05"), amount: 350, amountBase: 350, isTransfer: false },
        ],
        holdings: [
          // Bought 10 for 500 with the broker's cash, sold 5 for 350 (realized 100), removed in March holding 5 (cost 250).
          holding({
            id: "vale",
            currentPrice: 60,
            removedAt: d("2026-03-10"),
            operations: [
              op("b", "2026-01-05", { type: "buy", quantity: 10, pricePerUnit: 50, totalAmount: 500 }),
              op("s", "2026-02-05", { type: "sell", quantity: 5, pricePerUnit: 70, totalAmount: 350 }),
            ],
          }),
          // Registered without operations and removed: a posição inicial that comes in and goes out.
          holding({ id: "oibr", createdAt: d("2026-01-20"), currentQuantity: 100, totalInvested: 200, currentPrice: 1, removedAt: d("2026-03-12"), operations: [] }),
        ],
      })
    );
    // While held, they count like any position.
    expect(t.state("pf", 202602)).toMatchObject({ cash: 850, costBasis: 450, contributed: 1200, initialPositions: 200 });
    const mar = t.state("pf", 202603);
    // Out at cost (250 + 200): Patrimônio 850 of cash, Total aportado 750, so the realized 100 stays as Resultado.
    expect(mar).toMatchObject({ cash: 850, costBasis: 0, contributed: 750, initialPositions: 0, netFlow: -450, positions: [] });
    expect(t.value(mar, "price").marketValue).toBe(0);
  });

  it("removes nothing from a deactivated holding that was already closed (its gain stays)", () => {
    const t = buildTimeline(
      input({
        entries: [
          { accountId: "xp", date: d("2026-01-02"), amount: 500, amountBase: 500, isTransfer: true },
          { accountId: "xp", date: d("2026-01-05"), amount: -500, amountBase: -500, isTransfer: false },
          { accountId: "xp", date: d("2026-02-05"), amount: 700, amountBase: 700, isTransfer: false },
        ],
        holdings: [
          holding({
            id: "h",
            removedAt: d("2026-03-01"),
            operations: [
              op("b", "2026-01-05", { type: "buy", quantity: 10, pricePerUnit: 50, totalAmount: 500 }),
              op("s", "2026-02-05", { type: "sell", quantity: 10, pricePerUnit: 70, totalAmount: 700 }),
            ],
          }),
        ],
      })
    );
    expect(t.state("pf", 202603)).toMatchObject({ cash: 700, contributed: 500, netFlow: 0, positions: [] });
  });

  it("keeps amount-based fixed income at its cost when it has no price", () => {
    const t = buildTimeline(
      input({
        holdings: [holding({ id: "cdb", assetClass: "fixed_income", allocationClass: "fixed_income", operations: [op("a", "2026-01-02", { type: "buy", totalAmount: 5000 })] })],
      })
    );
    const s = t.state("pf", 202601);
    expect(t.value(s, "price").marketValue).toBe(5000);
    expect(t.value(s, "cost").marketValue).toBe(5000);
  });
});
