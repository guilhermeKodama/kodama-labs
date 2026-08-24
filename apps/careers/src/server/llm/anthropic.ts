import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "../../env";

let client: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (client) return client;
  if (!env.ANTHROPIC_API_KEY) {
    console.warn("[llm] ANTHROPIC_API_KEY não configurada — scoring e sugestões ficam desligados.");
    return null;
  }
  client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return client;
}

// Pricing snapshot for cost accounting (USD per million tokens). Update
// alongside env.SCORE_MODEL / env.SUGGEST_MODEL if the defaults change.
const PRICING: Record<string, { input: number; output: number; cacheWrite: number; cacheRead: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5, cacheWrite: 2, cacheRead: 0.1 },
  "claude-opus-5": { input: 5, output: 25, cacheWrite: 10, cacheRead: 0.5 },
};

function estimateCostUsd(model: string, usage: Anthropic.Usage): number {
  const price = PRICING[model] ?? PRICING["claude-haiku-4-5"]!;
  const input = (usage.input_tokens / 1_000_000) * price.input;
  const output = (usage.output_tokens / 1_000_000) * price.output;
  const cacheWrite = ((usage.cache_creation_input_tokens ?? 0) / 1_000_000) * price.cacheWrite;
  const cacheRead = ((usage.cache_read_input_tokens ?? 0) / 1_000_000) * price.cacheRead;
  return input + output + cacheWrite + cacheRead;
}

export type ParseJsonInput<T extends z.ZodTypeAny> = {
  model: string;
  /**
   * System blocks in render order. The LAST block in this array that
   * should be cached carries cache_control — callers append their
   * volatile suffix (few-shots regenerated daily, etc.) as later, uncached
   * entries so the stable prefix keeps hitting cache even as later blocks
   * change day to day.
   */
  systemBlocks: Anthropic.TextBlockParam[];
  user: string;
  schema: T;
  maxTokens?: number;
};

export type ParseJsonResult<T> = {
  data: T;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  costUsd: number;
  durationMs: number;
};

/**
 * Single place that knows how to talk to Claude — structured output via
 * client.messages.parse() + a Zod schema, never prompt-begging for JSON.
 * Every call's usage is returned so the caller can persist an LlmCall row;
 * this function does not write to the database itself.
 */
export async function parseJson<T extends z.ZodTypeAny>(
  input: ParseJsonInput<T>
): Promise<ParseJsonResult<z.infer<T>>> {
  const anthropic = getClient();
  if (!anthropic) {
    throw new Error("ANTHROPIC_API_KEY não configurada.");
  }

  const startedAt = Date.now();
  const response = await anthropic.messages.parse({
    model: input.model,
    max_tokens: input.maxTokens ?? 2048,
    system: input.systemBlocks,
    messages: [{ role: "user", content: input.user }],
    output_config: { format: zodOutputFormat(input.schema) },
  });
  const durationMs = Date.now() - startedAt;

  if (!response.parsed_output) {
    throw new Error(`Claude não retornou saída estruturada válida (stop_reason: ${response.stop_reason}).`);
  }

  return {
    data: response.parsed_output,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: response.usage.cache_read_input_tokens ?? 0,
    costUsd: estimateCostUsd(input.model, response.usage),
    durationMs,
  };
}

export function isLlmConfigured(): boolean {
  return getClient() !== null;
}
