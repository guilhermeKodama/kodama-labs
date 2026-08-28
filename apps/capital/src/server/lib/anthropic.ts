import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";

let client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  if (client) return client;
  if (!env.ANTHROPIC_API_KEY) {
    console.warn(
      "[assistant] ANTHROPIC_API_KEY não configurada — o assistente de extratos fica desligado."
    );
    return null;
  }
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

export function isLlmConfigured(): boolean {
  return getAnthropicClient() !== null;
}

// Pricing snapshot for cost accounting (USD per million tokens). Update
// alongside env.CAPITAL_AGENT_MODEL if the default changes.
const PRICING: Record<
  string,
  { input: number; output: number; cacheWrite: number; cacheRead: number }
> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 2, cacheRead: 0.1 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
  "claude-sonnet-5": { input: 3, output: 15, cacheWrite: 6, cacheRead: 0.3 },
};

// Anthropic's web_search server tool is billed per search, separate from
// token pricing - not reflected in input/output tokens at all.
const WEB_SEARCH_COST_PER_REQUEST = 0.01;

export function estimateCostUsd(model: string, usage: Anthropic.Usage): number {
  const price = PRICING[model] ?? PRICING["claude-opus-5"]!;
  const input = (usage.input_tokens / 1_000_000) * price.input;
  const output = (usage.output_tokens / 1_000_000) * price.output;
  const cacheWrite =
    ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * price.cacheWrite;
  const cacheRead =
    ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * price.cacheRead;
  const webSearch = (usage.server_tool_use?.web_search_requests ?? 0) * WEB_SEARCH_COST_PER_REQUEST;
  return input + output + cacheWrite + cacheRead + webSearch;
}
