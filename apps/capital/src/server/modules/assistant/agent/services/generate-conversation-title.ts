import { prisma } from "@capital/server/lib/prisma";
import { getAnthropicClient } from "@capital/server/lib/anthropic";

const TITLE_MODEL = "claude-haiku-4-5";
const MAX_TITLE_LENGTH = 60;

/**
 * Best-effort: generate a short title for a brand-new conversation from
 * its first user message, and persist it. No-ops (never throws) if the
 * conversation already has a title (manual rename or a prior call already
 * won), if there's nothing to summarize, or if the LLM call fails - a
 * missing title just falls back to "New conversation" in the UI, same as
 * today, so this is never worth failing the turn over.
 */
export async function maybeGenerateConversationTitle(
  conversationId: string,
  text: string | undefined,
  attachedFileNames: string[]
): Promise<void> {
  const anthropic = getAnthropicClient();
  if (!anthropic) return;

  const basis = [text?.trim(), ...attachedFileNames].filter(Boolean).join(" - ");
  if (!basis) return;

  try {
    const conversation = await prisma.agentConversation.findUnique({
      where: { id: conversationId },
      select: { title: true },
    });
    if (!conversation || conversation.title) return;

    const message = await anthropic.messages.create({
      model: TITLE_MODEL,
      max_tokens: 30,
      messages: [
        {
          role: "user",
          content: `Generate a short title (max 6 words, no quotes, no punctuation at the end, same language as the input) for a finance-assistant chat conversation that starts with this message:\n\n${basis}\n\nReply with ONLY the title.`,
        },
      ],
    });

    const textBlock = message.content.find((b) => b.type === "text");
    const title = textBlock?.text.trim().replace(/^["']|["']$/g, "").slice(0, MAX_TITLE_LENGTH);
    if (!title) return;

    // Second title-is-null check happens implicitly: this is the only
    // writer of a first title, and a concurrent second turn on the same
    // brand-new conversation is not a realistic race (the composer is
    // disabled while a turn is running).
    await prisma.agentConversation.update({
      where: { id: conversationId },
      data: { title },
    });
  } catch (error) {
    console.error("[assistant] title generation failed:", error);
  }
}
