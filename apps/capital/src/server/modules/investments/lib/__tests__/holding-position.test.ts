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

  it("keeps quantity on a by-value buy and redemption, and still takes an amount-based sell from cost", () => {
    const open = op("adjustment", { quantity: 1, pricePerUnit: 29883, totalAmount: 29883, adjustmentMode: "absolute" });
    const bought = replayPosition([open, op("buy", { quantity: 0, totalAmount: 10000 })]);
    expect(bought).toMatchObject({ quantity: 1, cost: 39883, averageCost: 39883, realizedGain: 0, closed: false });
    const costRemoved = 29883 * (10000 / 39943.76);
    const redeemed = replayPosition([open, op("sell", { quantity: 0, pricePerUnit: costRemoved, totalAmount: 10000 })]);
    expect(redeemed.quantity).toBe(1);
    expect(redeemed.cost).toBeCloseTo(29883 - costRemoved, 6);
    expect(redeemed.realizedGain).toBeCloseTo(10000 - costRemoved, 6);
    expect(redeemed.closed).toBe(false);
    expect(replayPosition([open, op("sell", { quantity: 1, totalAmount: 39943.76 })])).toMatchObject({ quantity: 0, cost: 0, closed: true });
    // quantity null stays on the amount path: a sell below cost takes the cash out of the cost and realizes nothing.
    expect(replayPosition([op("buy", { totalAmount: 29883 }), op("sell", { totalAmount: 10000 })]).realizedGain).toBe(0);
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

  it("scales a delta adjustment so the average cost stays, and still resets when the mode is absolute", () => {
    const buy = op("buy", { quantity: 18.672, pricePerUnit: 144.67, totalAmount: 18.672 * 144.67 });
    const delta = replayPosition([buy, op("adjustment", { quantity: -1.3929, pricePerUnit: 148.5, totalAmount: 0, adjustmentMode: "delta" })]);
    expect(delta.quantity).toBeCloseTo(17.2791, 4);
    expect(delta.averageCost).toBeCloseTo(144.67, 2);
    expect(delta.cost).toBeCloseTo(17.2791 * 144.67, 2);
    expect(delta.closed).toBe(false);
    const absolute = replayPosition([buy, op("adjustment", { quantity: -1.3929, pricePerUnit: 148.5, totalAmount: 0 })]);
    expect(absolute).toMatchObject({ quantity: 0, cost: 0, closed: true });
    expect(replayPosition([buy, op("adjustment", { quantity: 10, pricePerUnit: 20, totalAmount: 200, adjustmentMode: "absolute" })]).quantity).toBe(10);
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

describe("replayPosition edge cases", () => {
  it("treats a missing fee as zero on a buy and on a sale", () => {
    const noFees = (o: PositionOperation) => ({ ...o, fees: undefined as unknown as number });
    const p = replayPosition([
      noFees(op("buy", { quantity: 10, pricePerUnit: 10, totalAmount: 100 })),
      noFees(op("sell", { quantity: 5, pricePerUnit: 12, totalAmount: 60 })),
    ]);
    expect(p).toMatchObject({ quantity: 5, cost: 50, realizedGain: 10 });
  });

  it("proceeds a sale with no amount as quantity x price", () => {
    const p = replayPosition([op("buy", { quantity: 10, pricePerUnit: 10, totalAmount: 100 }), op("sell", { quantity: 4, pricePerUnit: 15 })]);
    // 4 x 15 = 60 against 4/10 of the 100 cost.
    expect(p).toMatchObject({ quantity: 6, cost: 60, realizedGain: 20 });
  });

  it("proceeds a clamped oversale only for the part that was held", () => {
    const sell = op("sell", { quantity: 20, pricePerUnit: 15, totalAmount: 300 });
    const p = replayPosition([op("buy", { quantity: 10, pricePerUnit: 10, totalAmount: 100 }), sell]);
    // Half of the 300 proceeds (10 of the 20 asked) against the whole 100 cost.
    expect(p.realizedGain).toBe(50);
    expect(p.oversold).toEqual([sell.id]);
  });

  it("starts a delta adjustment on an empty position at zero cost, and closes it when the delta empties the position", () => {
    const fromEmpty = replayPosition([op("adjustment", { quantity: 3, pricePerUnit: 10, totalAmount: 0, adjustmentMode: "delta" })]);
    expect(fromEmpty).toMatchObject({ quantity: 3, cost: 0, closed: false });
    const emptied = replayPosition([op("buy", { quantity: 10, pricePerUnit: 10, totalAmount: 100 }), op("adjustment", { quantity: -10, pricePerUnit: 10, totalAmount: 0, adjustmentMode: "delta" })]);
    expect(emptied).toMatchObject({ quantity: 0, cost: 0, closed: true });
  });

  it("moves only the cost basis for an adjustment with an amount and no quantity, never below zero", () => {
    const buy = op("buy", { quantity: 10, pricePerUnit: 10, totalAmount: 100 });
    expect(replayPosition([buy, op("adjustment", { totalAmount: 25 })])).toMatchObject({ quantity: 10, cost: 125, closed: false });
    expect(replayPosition([buy, op("adjustment", { totalAmount: -500 })])).toMatchObject({ quantity: 10, cost: 0 });
  });

  it("ignores an operation type it does not know", () => {
    const p = replayPosition([op("buy", { quantity: 1, pricePerUnit: 10, totalAmount: 10 }), op("transfer" as PositionOperation["type"], { totalAmount: 99 })]);
    expect(p).toMatchObject({ quantity: 1, cost: 10 });
  });
});

describe("operationsBeforeUndo with odd snapshots", () => {
  const snapshotOf = (fields: Record<string, unknown>) => ({ id: "snap", holdingId: "h1", type: "buy", date: "2026-09-10T00:00:00.000Z", ...fields });
  const record = (after: unknown) => ({ model: "InvestmentOperation", recordId: "snap", before: null, after });

  it("fills a snapshot's missing numbers and creation time, and reads numeric strings", () => {
    const [rebuilt] = operationsBeforeUndo("h1", [], [record(snapshotOf({ quantity: "2.5", pricePerUnit: null, totalAmount: null }))]);
    expect(rebuilt).toMatchObject({ id: "snap", type: "buy", quantity: 2.5, pricePerUnit: null, totalAmount: 0, fees: 0 });
    expect(rebuilt).toMatchObject({ createdAt: new Date("2026-09-10T00:00:00.000Z") });
  });

  it("drops snapshots that are not an operation of the holding", () => {
    const rebuilt = operationsBeforeUndo("h1", [], [
      record("not an object"),
      record(null),
      record(snapshotOf({ id: 7 })),
      record(snapshotOf({ holdingId: undefined })),
      record(snapshotOf({ type: undefined })),
      record(snapshotOf({ holdingId: "another-holding" })),
    ]);
    expect(rebuilt).toEqual([]);
  });

  it("breaks a tie on the same date by creation time", () => {
    const rebuilt = operationsBeforeUndo("h1", [], [
      { model: "InvestmentOperation", recordId: "late", before: null, after: snapshotOf({ id: "late", createdAt: "2026-09-10T15:00:00.000Z" }) },
      { model: "InvestmentOperation", recordId: "early", before: null, after: snapshotOf({ id: "early", createdAt: "2026-09-10T08:00:00.000Z" }) },
    ]);
    expect(rebuilt.map((o) => o.id)).toEqual(["early", "late"]);
  });
});

describe("assertUndoKeepsPosition", () => {
  const at = (day: string) => ({ date: new Date(`2026-09-${day}T00:00:00Z`), createdAt: new Date(`2026-09-${day}T12:00:00Z`) });

  it("lets an undo through when nothing is oversold, and ignores oversold sales that came from an import", () => {
    expect(() => assertUndoKeepsPosition({ holdingId: "h1", label: "X", ops: [], position: replayPosition([]), undone: [] })).not.toThrow();
    const importedSale = { ...op("sell", { quantity: 5, pricePerUnit: 10, totalAmount: 50 }), ...at("01"), externalId: "nota-1" };
    expect(() => assertUndoKeepsPosition({ holdingId: "h1", label: "X", ops: [importedSale], position: replayPosition([importedSale]), undone: [] })).not.toThrow();
  });
});
