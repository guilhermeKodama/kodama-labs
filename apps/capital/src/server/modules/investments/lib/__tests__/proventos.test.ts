import { describe, expect, it } from "vitest";
import { unmatchedProventos, type ProventoCandidate } from "../proventos";

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).getTime();
const op = (id: string, iso: string, base: number): ProventoCandidate => ({ id, at: day(iso), base });

describe("unmatchedProventos", () => {
  it("drops an income row an operation already took, and keeps each operation for one row", () => {
    const operations = [op("gogl", "2026-08-10", 1122.88), op("fii", "2026-09-15", 200)];
    const entries = [op("checking", "2026-08-12", 1122.88), op("again", "2026-08-14", 1122.88), op("sep", "2026-09-20", 2252.12)];
    expect(unmatchedProventos(operations, entries).sort()).toEqual(["again", "sep"]);
  });

  it("does not match across more than seven days or more than one cent", () => {
    const operations = [op("a", "2026-08-01", 100)];
    expect(unmatchedProventos(operations, [op("far", "2026-08-09", 100)])).toEqual(["far"]);
    expect(unmatchedProventos(operations, [op("off", "2026-08-02", 100.02)])).toEqual(["off"]);
    expect(unmatchedProventos(operations, [op("near", "2026-08-08", 100.009)])).toEqual([]);
  });
});

describe("unmatchedProventos ordering", () => {
  it("breaks ties between operations on the same instant by id, so the same row is matched whatever the input order", () => {
    const operations = [op("op-b", "2026-08-10", 100), op("op-a", "2026-08-10", 100)];
    const entries = [op("e1", "2026-08-10", 100), op("e2", "2026-08-10", 100), op("e3", "2026-08-10", 100)];
    // Two operations absorb two of the three rows; the last row in id order is left over.
    expect(unmatchedProventos(operations, entries)).toEqual(["e3"]);
    expect(unmatchedProventos([...operations].reverse(), [...entries].reverse())).toEqual(["e3"]);
  });

  it("matches an entry with the closest operation in time when several fit", () => {
    const operations = [op("early", "2026-08-01", 100), op("close", "2026-08-09", 100)];
    expect(unmatchedProventos(operations, [op("e", "2026-08-10", 100)])).toEqual([]);
    // "close" was taken, so a second row can only use "early", 9 days away: too far.
    expect(unmatchedProventos(operations, [op("e1", "2026-08-10", 100), op("e2", "2026-08-10", 100)])).toEqual(["e2"]);
  });

  it("returns every row when there are no operations", () => {
    expect(unmatchedProventos([], [op("a", "2026-08-10", 1), op("b", "2026-08-11", 2)])).toEqual(["a", "b"]);
  });
});
