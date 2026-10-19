import { env } from "@/env";
import { getAnthropicClient } from "@capital/server/lib/anthropic";
import type { IncomeGuesser, IncomeKind } from "./classify";

const KINDS = new Set<IncomeKind>(["fii_income", "dividend", "jcp", "interest"]);

/**
 * Haiku classifies the INTEREST rows the rules leave open. No key means
 * no call: the sync books a zero-confidence guess and opens a review.
 */
export function anthropicIncomeGuesser(): IncomeGuesser {
  return async (input) => {
    if (!env.ANTHROPIC_API_KEY) return null;
    const client = getAnthropicClient();
    if (!client) return null;
    const response = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 200,
      messages: [
        {
          role: "user",
          content: [
            "Classify this Brazilian investment distribution. Reply with JSON only:",
            '{"incomeType":"fii_income|dividend|jcp|interest","origin":"br|bdr|exterior|null","confidence":0..1}',
            "fii_income is a real-estate fund distribution. jcp is interest on equity (IR withheld).",
            "dividend origin is br, bdr or exterior. interest is fixed income, including a caixinha CDB.",
            "Amortization, a sale, a transfer and a redemption are not income; if this is one of those, use interest with confidence 0.",
            JSON.stringify({
              description: input.description,
              ticker: input.ticker,
              assetType: input.assetType,
              assetSubtype: input.assetSubtype,
              name: input.assetName,
              incomeTax: input.incomeTax ?? 0,
              amount: input.amount,
            }),
          ].join("\n"),
        },
      ],
    });
    const block = response.content[0];
    if (!block || block.type !== "text") return null;
    const text = block.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    const parsed = JSON.parse(text) as { incomeType?: string; origin?: string | null; confidence?: number };
    if (!parsed.incomeType || !KINDS.has(parsed.incomeType as IncomeKind)) return null;
    const origin = parsed.origin === "br" || parsed.origin === "bdr" || parsed.origin === "exterior" ? parsed.origin : null;
    return { incomeType: parsed.incomeType as IncomeKind, origin, confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0 };
  };
}
