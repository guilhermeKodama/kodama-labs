import { describe, expect, it, vi } from "vitest";
import { env } from "@/env";
import { anthropicIncomeGuesser } from "../lib/guesser";

describe("anthropicIncomeGuesser", () => {
  it("does not call Anthropic when no key is configured", async () => {
    if (env.ANTHROPIC_API_KEY) return;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network"));
    await expect(anthropicIncomeGuesser()({ type: "INTEREST", amount: 10, description: "x" })).resolves.toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
