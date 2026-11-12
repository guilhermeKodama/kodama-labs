import { describe, expect, it } from "vitest";
import { isoOrNull } from "../time";

describe("isoOrNull", () => {
  it("formats a valid Date as a full ISO instant and drops an invalid one", () => {
    expect(isoOrNull(new Date("2026-10-05T17:32:00Z"))).toBe("2026-10-05T17:32:00.000Z");
    expect(isoOrNull(new Date("not a date"))).toBeNull();
  });

  it("reads a number up to 1e12 as epoch seconds and a bigger one as milliseconds", () => {
    expect(isoOrNull(1_791_221_520)).toBe("2026-10-05T17:32:00.000Z");
    expect(isoOrNull(1_791_221_520_000)).toBe("2026-10-05T17:32:00.000Z");
  });

  it("parses a non-empty string and drops an unparseable one", () => {
    expect(isoOrNull("2026-10-05T17:32:00Z")).toBe("2026-10-05T17:32:00.000Z");
    expect(isoOrNull("sometime next week")).toBeNull();
  });

  it("is null for an empty string, null, undefined and any other type", () => {
    expect(isoOrNull("")).toBeNull();
    expect(isoOrNull(null)).toBeNull();
    expect(isoOrNull(undefined)).toBeNull();
    expect(isoOrNull({})).toBeNull();
    expect(isoOrNull(true)).toBeNull();
  });
});
