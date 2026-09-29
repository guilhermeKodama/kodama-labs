import { describe, it, expect } from "vitest";
import { parseDateRangeFilter } from "../date-helpers";

describe("MCP Date Helpers", () => {
  describe("parseDateRangeFilter", () => {
    it("should return empty object when both dates are undefined", () => {
      const result = parseDateRangeFilter(undefined, undefined);
      expect(result).toEqual({});
    });

    it("should parse dateFrom to start of day (00:00:00.000Z)", () => {
      const result = parseDateRangeFilter("2026-07-01", undefined);
      
      expect(result.dateFrom).toBeDefined();
      expect(result.dateFrom?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(result.dateTo).toBeUndefined();
    });

    it("should parse dateTo to end of day (23:59:59.999Z)", () => {
      const result = parseDateRangeFilter(undefined, "2026-07-01");
      
      expect(result.dateFrom).toBeUndefined();
      expect(result.dateTo).toBeDefined();
      expect(result.dateTo?.toISOString()).toBe("2026-07-01T23:59:59.999Z");
    });

    it("should parse both dates for inclusive range", () => {
      const result = parseDateRangeFilter("2026-07-01", "2026-07-31");
      
      expect(result.dateFrom?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
      expect(result.dateTo?.toISOString()).toBe("2026-07-31T23:59:59.999Z");
    });

    it("should handle ISO datetime strings for dateFrom", () => {
      const result = parseDateRangeFilter("2026-07-01T12:00:00.000Z", undefined);
      
      // Should normalize to start of day regardless of input time
      expect(result.dateFrom?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
    });

    it("should handle ISO datetime strings for dateTo", () => {
      const result = parseDateRangeFilter(undefined, "2026-07-01T12:00:00.000Z");
      
      // Should normalize to end of day regardless of input time
      expect(result.dateTo?.toISOString()).toBe("2026-07-01T23:59:59.999Z");
    });

    it("should make filter inclusive of transactions at noon UTC", () => {
      // UI creates transactions at 12:00 UTC
      // Filter for 2026-07-01 should include transactions at 2026-07-01T12:00:00.000Z
      const result = parseDateRangeFilter("2026-07-01", "2026-07-01");
      
      const noonUTC = new Date("2026-07-01T12:00:00.000Z");
      
      expect(result.dateFrom!.getTime()).toBeLessThanOrEqual(noonUTC.getTime());
      expect(result.dateTo!.getTime()).toBeGreaterThanOrEqual(noonUTC.getTime());
    });
  });
});
