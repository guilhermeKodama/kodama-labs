import { describe, expect, it } from "vitest";
import { assertUndoKeepsPosition, nextIsActive, operationsBeforeUndo, replayPosition, type PositionOperation } from "../holding-position";

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

describe("nextIsActive", () => {
  const stored = (isActive: boolean, currentQuantity: number, totalInvested: number) => ({ isActive, currentQuantity, totalInvested });
  const empty = replayPosition([]);

  it("deactivates a holding whose position is gone because its buys were deleted or undone", () => {
    expect(nextIsActive(stored(true, 5, 642), empty)).toBe(false);
    // Amount-based assets count their cost basis as the position.
    expect(nextIsActive(stored(true, 0, 1000), empty)).toBe(false);
  });

  it("keeps a holding that never had a position, brings back an emptied one and leaves one deactivated by hand", () => {
    expect(nextIsActive(stored(true, 0, 0), empty)).toBe(true);
    const bought = replayPosition([op("buy", { quantity: 1, pricePerUnit: 10, totalAmount: 10 })]);
    expect(nextIsActive(stored(false, 0, 0), bought)).toBe(true);
    expect(nextIsActive(stored(false, 1, 10), bought)).toBe(false);
  });
});

describe("undo guard", () => {
  const at = (day: string) => ({ date: new Date(`2026-09-${day}T00:00:00Z`), createdAt: new Date(`2026-09-${day}T12:00:00Z`) });
  const row = (o: PositionOperation, day: string) => ({ ...o, ...at(day), holdingId: "h1" });
  const json = (o: ReturnType<typeof row>) => JSON.parse(JSON.stringify(o)) as unknown;

  it("rebuilds the operations before an undo: created and updated ones as the batch left them, deleted ones gone", () => {
    const buy = row(op("buy", { quantity: 10, pricePerUnit: 10, totalAmount: 100 }), "10");
    const sell = row(op("sell", { quantity: 10, pricePerUnit: 12, totalAmount: 120 }), "20");
    const edited = row(op("buy", { quantity: 2, pricePerUnit: 10, totalAmount: 20 }), "05");
    const recreated = row(op("dividend", { totalAmount: 3 }), "25");
    const before = operationsBeforeUndo("h1", [{ ...edited, quantity: 1 }, sell, recreated], [
      { model: "InvestmentOperation", recordId: buy.id, before: null, after: json(buy) },
      { model: "InvestmentOperation", recordId: edited.id, before: json({ ...edited, quantity: 1 }), after: json(edited) },
      { model: "InvestmentOperation", recordId: recreated.id, before: json(recreated), after: null },
      { model: "LedgerEntry", recordId: "leg", before: null, after: {} },
    ]);
    expect(before.map((o) => [o.id, o.quantity])).toEqual([
      [edited.id, 2],
      [buy.id, 10],
      [sell.id, 10],
    ]);
  });

  it("refuses an undo that leaves a sale above the position, but not one whose sales were already above it", () => {
    const buy = row(op("buy", { quantity: 40, pricePerUnit: 128, totalAmount: 5120 }), "10");
    const sell = row(op("sell", { quantity: 40, pricePerUnit: 130, totalAmount: 5200 }), "20");
    const undone = [{ model: "InvestmentOperation", recordId: buy.id, before: null, after: json(buy) }];
    const left = [sell];
    expect(() => assertUndoKeepsPosition({ holdingId: "h1", label: "BOVA11", ops: left, position: replayPosition(left), undone })).toThrow(
      expect.objectContaining({ status: 409, code: "holding.undo_oversell", params: { holding: "BOVA11" } })
    );
    // The sale was already above the position before the undo (an imported history): the undo goes through.
    const imported = row(op("sell", { quantity: 5, pricePerUnit: 10, totalAmount: 50 }), "01");
    const smallBuy = row(op("buy", { quantity: 3, pricePerUnit: 10, totalAmount: 30 }), "15");
    expect(() =>
      assertUndoKeepsPosition({
        holdingId: "h1",
        label: "ITSA4",
        ops: [imported],
        position: replayPosition([imported]),
        undone: [{ model: "InvestmentOperation", recordId: smallBuy.id, before: null, after: json(smallBuy) }],
      })
    ).not.toThrow();
  });
});
