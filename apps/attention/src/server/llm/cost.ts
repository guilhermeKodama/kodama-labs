import { prisma } from "../lib/prisma";

// Named cost.ts to match the plan's vocabulary, but running local models has
// no dollar cost — durationMs is the health signal that replaces it.
export async function recordLlmCall(input: {
  purpose: "triage" | "draft";
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  durationMs?: number;
  messageId?: string;
  error?: string;
}): Promise<void> {
  await prisma.llmCall.create({
    data: {
      purpose: input.purpose,
      model: input.model,
      inputTokens: input.inputTokens ?? 0,
      outputTokens: input.outputTokens ?? 0,
      durationMs: input.durationMs ?? 0,
      messageId: input.messageId,
      error: input.error,
    },
  });
}
