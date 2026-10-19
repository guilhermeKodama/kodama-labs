import { env } from "@/env";
import type { DividendOrigin } from "@/generated/prisma";
import { getAnthropicClient } from "@capital/server/lib/anthropic";
import type { IncomeGuesser, IncomeKind } from "./classify";
import { redactForModel } from "./mask";

const KINDS = new Set<IncomeKind>(["fii_income", "dividend", "jcp", "fixed_income_interest"]);
const MODEL_TIMEOUT_MS = 20_000;

const ORIGIN: Record<string, DividendOrigin> = { BR: "BR", BDR: "BDR", EXTERIOR: "EXTERIOR", br: "BR", bdr: "BDR", exterior: "EXTERIOR" };

/**
 * Haiku classifies the INTEREST rows the rules leave open. No key means
 * no call. A timeout, a transport error or JSON that is not the expected
 * shape returns null so the sync can leave a review instead of failing.
 */
export function anthropicIncomeGuesser(): IncomeGuesser {
  return async (input) => {
    if (!env.ANTHROPIC_API_KEY) return null;
    const client = getAnthropicClient();
    if (!client) return null;
    try {
      const response = await client.messages.create(
        {
          model: "claude-haiku-4-5",
          max_tokens: 200,
          messages: [
            {
              role: "user",
              content: [
                "Classify this Brazilian investment distribution. Reply with JSON only:",
                '{"incomeType":"fii_income|dividend|jcp|fixed_income_interest","origin":"BR|BDR|EXTERIOR|null","confidence":0..1}',
                "fii_income is a real-estate fund distribution. jcp is interest on equity (IR withheld).",
                "dividend origin is BR, BDR or EXTERIOR. fixed_income_interest is a CDB, Tesouro or caixinha.",
                "Amortization, a sale, a transfer and a redemption are not income; if this is one of those, use fixed_income_interest with confidence 0.",
                JSON.stringify({
                  description: redactForModel(input.description ?? ""),
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
        },
        { timeout: MODEL_TIMEOUT_MS },
      );
      const block = response.content[0];
      if (!block || block.type !== "text") return null;
      const text = block.text.trim().replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      const parsed = JSON.parse(text) as { incomeType?: string; origin?: string | null; confidence?: number };
      if (!parsed.incomeType || !KINDS.has(parsed.incomeType as IncomeKind)) return null;
      const origin = parsed.origin ? ORIGIN[parsed.origin] ?? null : null;
      return { incomeType: parsed.incomeType as IncomeKind, origin, confidence: typeof parsed.confidence === "number" ? parsed.confidence : 0 };
    } catch {
      return null;
    }
  };
}
