import { randomUUID } from "node:crypto";
import { z } from "zod";
import { defineTool } from "../registry";

const DuplicateReviewPairSchema = z.object({
  pairId: z.string(),
  incoming: z.object({
    description: z.string(),
    date: z.string(),
    amount: z.number(),
    type: z.enum(["income", "expense"]),
  }),
  existing: z.object({
    id: z.string(),
    description: z.string(),
    date: z.string(),
    amount: z.number(),
    type: z.enum(["income", "expense"]),
  }),
  confidence: z.enum(["high", "medium", "low"]),
  reason: z.string(),
  diffs: z
    .array(z.object({ field: z.string(), existingValue: z.string(), incomingValue: z.string() }))
    .optional(),
});

/**
 * The only card type in v1. Import-plan, confirm and result cards are
 * NOT presented through this tool - they render directly from ImportPlan
 * state via the plan_proposed SSE event, because their "yes" has to come
 * from the confirm endpoint, not a chat message. present_card is for
 * decisions that are genuinely just information for the plan (which
 * duplicate wins), not a domain-write confirmation.
 */
export const presentCard = defineTool({
  name: "present_card",
  description:
    "Show a duplicate-review card in the chat: one or more fuzzy-match/changed-transaction pairs the user resolves by clicking (keep both / merge / skip) instead of answering in free text. Prefer this whenever the decision is a closed set of options - clicking beats typing. The user's choice comes back to you as a card_response on a later turn; it does not confirm or write anything by itself, it is information for the import plan you build next.",
  inputSchema: z.object({
    cardType: z.literal("duplicate_review"),
    pairs: z.array(DuplicateReviewPairSchema).min(1),
  }),
  access: "read",
  handler: async (_ctx, input) => {
    return {
      cardId: randomUUID(),
      cardType: input.cardType,
      pairs: input.pairs,
      status: "pending",
    };
  },
});
