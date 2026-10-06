import { describe, expect, it } from "vitest";
import { replayPosition, type PositionOperation } from "../holding-position";

let n = 0;
const op = (type: PositionOperation["type"], fields: Partial<Omit<PositionOperation, "id" | "type">> = {}): PositionOperation => ({
  id: `op-${++n}`,
  type,
  quantity: null,
  pricePerUnit: null,
  totalAmount: 0,
  fees: 0,
  ...fields,
});

describe("replayPosition", () => {
  it("puts fees in the cost and keeps the average cost through a partial sale", () => {
    const p = replayPosition([
      op("buy", { quantity: 100, pricePerUnit: 30, totalAmount: 3000, fees: 10 }),
      op("sell", { quantity: 50, pricePerUnit: 35, totalAmount: 1750, fees: 5 }),
    ]);
    expect(p.quantity).toBe(50);
    expect(p.averageCost).toBeCloseTo(30.1, 10);
    expect(p.cost).toBeCloseTo(1505, 10);
    // 1750 - 5 fees - 1505 cost of the half sold
    expect(p.realizedGain).toBeCloseTo(240, 10);
    expect(p.closed).toBe(false);
    expect(p.oversold).toEqual([]);
  });

  it("closes a position a sale empties, and a later buy reopens it", () => {
    const buy = op("buy", { quantity: 10, pricePerUnit: 10, totalAmount: 100 });
    const sell = op("sell", { quantity: 10, pricePerUnit: 12, totalAmount: 120 });
    expect(replayPosition([buy, sell])).toMatchObject({ quantity: 0, cost: 0, averageCost: 0, closed: true });
    expect(replayPosition([buy, sell, op("buy", { quantity: 1, pricePerUnit: 11, totalAmount: 11 })])).toMatchObject({ quantity: 1, cost: 11, closed: false });
  });

  it("clamps and reports a sale above the position", () => {
    const sell = op("sell", { quantity: 15, pricePerUnit: 10, totalAmount: 150 });
    const p = replayPosition([op("buy", { quantity: 10, pricePerUnit: 10, totalAmount: 100 }), sell]);
    expect(p.oversold).toEqual([sell.id]);
    expect(p).toMatchObject({ quantity: 0, cost: 0, closed: true });
  });

  it("tracks amount-based assets by amount", () => {
    const p = replayPosition([op("buy", { totalAmount: 1000 }), op("buy", { totalAmount: 500, fees: 2 }), op("sell", { totalAmount: 300 })]);
    expect(p).toMatchObject({ quantity: 0, cost: 1202, averageCost: 0, closed: false });
    expect(replayPosition([op("buy", { totalAmount: 1000 }), op("withdrawal", { totalAmount: 1100 })])).toMatchObject({ cost: 0, closed: true, realizedGain: 100 });
  });

  it("uses quantity x price when a buy has no amount, splits without touching the cost, and resets on a priced adjustment", () => {
    const p = replayPosition([op("buy", { quantity: 10, pricePerUnit: 20 }), op("split", { quantity: 10 })]);
    expect(p).toMatchObject({ quantity: 20, cost: 200, averageCost: 10 });
    expect(replayPosition([op("buy", { quantity: 10, pricePerUnit: 20, totalAmount: 200 }), op("adjustment", { quantity: 4, pricePerUnit: 25, totalAmount: 100 })])).toMatchObject({
      quantity: 4,
      cost: 100,
      averageCost: 25,
    });
    expect(replayPosition([op("buy", { quantity: 10, pricePerUnit: 20, totalAmount: 200 }), op("adjustment", { quantity: 0, pricePerUnit: 0 })])).toMatchObject({ quantity: 0, closed: true });
  });

  it("ignores income for the position", () => {
    expect(replayPosition([op("buy", { quantity: 1, pricePerUnit: 10, totalAmount: 10 }), op("dividend", { totalAmount: 3 }), op("yield_payment", { totalAmount: 1 })])).toMatchObject({
      quantity: 1,
      cost: 10,
    });
  });
});
