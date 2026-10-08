import { describe, expect, it } from "vitest";
import { previousBusinessDayRate } from "../fx";

describe("previousBusinessDayRate", () => {
  const closes = [
    { day: "2026-08-11", brlPerUnit: 5.1285 },
    { day: "2026-08-12", brlPerUnit: 5.1639 },
    { day: "2026-09-15", brlPerUnit: 5.149 },
    { day: "2026-09-16", brlPerUnit: 5.1527 },
  ];

  it("uses the latest close strictly before the day", () => {
    expect(previousBusinessDayRate(closes, "2026-08-12")).toBe(5.1285);
    expect(previousBusinessDayRate(closes, "2026-09-16")).toBe(5.149);
    expect(previousBusinessDayRate(closes, "2026-08-11")).toBeNull();
  });
});
