import { describe, expect, it } from "vitest";
import { mapWithConcurrency } from "../concurrency";

const tick = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("mapWithConcurrency", () => {
  it("returns the results in the order of the items, not of completion", async () => {
    const result = await mapWithConcurrency([30, 5, 15, 1], 4, async (ms) => {
      await tick(ms);
      return `done-${ms}`;
    });
    expect(result).toEqual(["done-30", "done-5", "done-15", "done-1"]);
  });

  it("never has more than `limit` calls in flight, and reaches the limit", async () => {
    let inFlight = 0;
    let peak = 0;
    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await tick(2);
      inFlight -= 1;
    });
    expect(peak).toBe(3);
    expect(inFlight).toBe(0);
  });

  it("runs one at a time for a limit of 1, and also for a limit below 1", async () => {
    for (const limit of [1, 0, -5]) {
      let inFlight = 0;
      let peak = 0;
      const order: number[] = [];
      await mapWithConcurrency([1, 2, 3, 4], limit, async (n) => {
        inFlight += 1;
        peak = Math.max(peak, inFlight);
        await tick(1);
        order.push(n);
        inFlight -= 1;
      });
      expect(peak).toBe(1);
      expect(order).toEqual([1, 2, 3, 4]);
    }
  });

  it("passes each item to fn exactly once when the limit exceeds the item count", async () => {
    const seen: string[] = [];
    const result = await mapWithConcurrency(["a", "b"], 50, async (item) => {
      seen.push(item);
      return item.toUpperCase();
    });
    expect(result).toEqual(["A", "B"]);
    expect(seen.sort()).toEqual(["a", "b"]);
  });

  it("returns an empty array for no items without calling fn", async () => {
    let calls = 0;
    const result = await mapWithConcurrency([], 5, async () => {
      calls += 1;
    });
    expect(result).toEqual([]);
    expect(calls).toBe(0);
  });

  it("rejects with the first failure", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (n) => {
        if (n === 2) throw new Error("item 2 failed");
        return n;
      }),
    ).rejects.toThrow("item 2 failed");
  });
});
