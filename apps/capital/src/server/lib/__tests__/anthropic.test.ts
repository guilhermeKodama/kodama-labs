import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";

/**
 * anthropic.ts keeps a module-level client, so every test loads a fresh copy
 * of the module with its own env and a stand-in for the SDK constructor.
 */
const sdk = vi.hoisted(() => ({ ctor: vi.fn() }));

async function load(apiKey: string | undefined) {
  vi.resetModules();
  vi.doMock("@/env", () => ({ env: { ANTHROPIC_API_KEY: apiKey } }));
  vi.doMock("@anthropic-ai/sdk", () => ({
    default: class FakeAnthropic {
      constructor(options: unknown) {
        sdk.ctor(options);
      }
    },
  }));
  return import("../anthropic");
}

beforeEach(() => {
  sdk.ctor.mockReset();
});

afterEach(() => {
  vi.doUnmock("@/env");
  vi.doUnmock("@anthropic-ai/sdk");
  vi.restoreAllMocks();
});

describe("getAnthropicClient / isLlmConfigured", () => {
  it("is null, with a warning, when ANTHROPIC_API_KEY is not set", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const mod = await load(undefined);

    expect(mod.getAnthropicClient()).toBeNull();
    expect(mod.isLlmConfigured()).toBe(false);
    expect(sdk.ctor).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("ANTHROPIC_API_KEY"));
  });

  it("builds the client with the configured key and reuses it afterwards", async () => {
    const mod = await load("sk-test-key");

    const first = mod.getAnthropicClient();
    const second = mod.getAnthropicClient();

    expect(first).not.toBeNull();
    expect(second).toBe(first);
    expect(sdk.ctor).toHaveBeenCalledTimes(1);
    expect(sdk.ctor).toHaveBeenCalledWith({ apiKey: "sk-test-key" });
    expect(mod.isLlmConfigured()).toBe(true);
  });
});

describe("estimateCostUsd", () => {
  const usage = (over: Partial<Anthropic.Usage>) => ({ input_tokens: 0, output_tokens: 0, ...over }) as Anthropic.Usage;

  it("prices input and output tokens per million for the model", async () => {
    const { estimateCostUsd } = await load(undefined);
    expect(estimateCostUsd("claude-haiku-4-5", usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 }))).toBeCloseTo(1 + 5, 10);
    expect(estimateCostUsd("claude-sonnet-5", usage({ input_tokens: 2_000_000, output_tokens: 500_000 }))).toBeCloseTo(6 + 7.5, 10);
    expect(estimateCostUsd("claude-opus-5", usage({ input_tokens: 100_000, output_tokens: 10_000 }))).toBeCloseTo(0.5 + 0.25, 10);
  });

  it("adds cache writes, cache reads and the per-request web search fee", async () => {
    const { estimateCostUsd } = await load(undefined);
    const cost = estimateCostUsd(
      "claude-haiku-4-5",
      usage({
        cache_creation_input_tokens: 1_000_000,
        cache_read_input_tokens: 10_000_000,
        server_tool_use: { web_search_requests: 3 },
      } as Partial<Anthropic.Usage>),
    );
    // 2 (cache write) + 10 * 0.1 (cache read) + 3 * 0.01 (searches)
    expect(cost).toBeCloseTo(2 + 1 + 0.03, 10);
  });

  it("treats missing cache and search fields as zero", async () => {
    const { estimateCostUsd } = await load(undefined);
    expect(
      estimateCostUsd("claude-sonnet-5", usage({ input_tokens: 1_000_000, cache_creation_input_tokens: null, cache_read_input_tokens: null } as Partial<Anthropic.Usage>)),
    ).toBeCloseTo(3, 10);
    expect(estimateCostUsd("claude-sonnet-5", usage({}))).toBe(0);
  });

  it("prices a model it does not know like the default Opus", async () => {
    const { estimateCostUsd } = await load(undefined);
    const tokens = usage({ input_tokens: 1_000_000, output_tokens: 1_000_000 });
    expect(estimateCostUsd("claude-future-9", tokens)).toBe(estimateCostUsd("claude-opus-5", tokens));
    expect(estimateCostUsd("claude-future-9", tokens)).toBeCloseTo(30, 10);
  });
});
