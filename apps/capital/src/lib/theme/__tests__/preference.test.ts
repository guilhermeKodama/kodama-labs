import { describe, expect, it } from "vitest";
import { parseThemePreference } from "../preference";

describe("parseThemePreference", () => {
  it("accepts the three settings", () => {
    expect(parseThemePreference("light")).toBe("light");
    expect(parseThemePreference("dark")).toBe("dark");
    expect(parseThemePreference("system")).toBe("system");
  });

  it("ignores anything else", () => {
    expect(parseThemePreference(undefined)).toBeNull();
    expect(parseThemePreference("")).toBeNull();
    expect(parseThemePreference("Dark")).toBeNull();
    expect(parseThemePreference(1)).toBeNull();
  });
});
