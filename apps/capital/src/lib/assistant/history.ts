import type { ChatMessage, ConversationSummary, MessageBlock, PlanStatus } from "@/types/assistant";
import { parseHistoryToMessages, type RawAgentMessage } from "./parse-history";
import { TURN_LIMIT_CODE, type AssistantError } from "./reducer";

/**
 * Resuming a conversation: GET /api/v1/assistant/conversations/{id}
 * returns the saved rows (Anthropic-shaped content), the plans with their
 * current status and the turns. This turns them into the same messages the
 * live stream builds (reducer.ts), with plans and cards in their final
 * state, so an answered card or a committed plan cannot be clicked again.
 */

export interface ConversationDetail {
  id: string;
  title: string | null;
  messages: RawAgentMessage[];
  plans: { id: string; status: PlanStatus }[];
  turns: { id: string; status: "running" | "completed" | "failed" | "cancelled"; createdAt: string; error: string | null }[];
}

export type { ConversationSummary };

/** "[Resposta do usuário ao card duplicate_review, cardId=…]\n- pair: label" (agent/loop.ts formatCardResponseText). */
const CARD_RESPONSE_ID = /cardId=([^\]\s]+)/;
const CARD_RESPONSE_LINE = /^- [^:]+: (.+)$/;

/** The labels of a saved card answer ("Manter os dois, Pular"); the text itself when it has another shape. */
export function cardResponseLabels(text: string): string {
  const labels = text
    .split("\n")
    .map((line) => CARD_RESPONSE_LINE.exec(line.trim())?.[1]?.trim())
    .filter((label): label is string => Boolean(label));
  return labels.length ? labels.join(", ") : text;
}

function answeredCards(messages: ChatMessage[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    for (const block of message.blocks) {
      if (block.kind !== "card_response") continue;
      const id = CARD_RESPONSE_ID.exec(block.text)?.[1];
      if (id) ids.add(id);
    }
  }
  return ids;
}

/** Blocks of a failed tool call never got their ids: nothing to confirm or answer there. */
function usable(block: MessageBlock): boolean {
  if (block.kind === "plan" || block.kind === "plan_result") return Boolean(block.planId);
  if (block.kind === "card") return Boolean(block.card.cardId);
  if (block.kind === "text") return block.text.trim().length > 0;
  return true;
}

export function messagesFromConversation(detail: Pick<ConversationDetail, "messages" | "plans">): ChatMessage[] {
  const planStatus = new Map(detail.plans.map((plan) => [plan.id, plan.status]));
  const parsed = parseHistoryToMessages(detail.messages);
  const answered = answeredCards(parsed);
  return parsed
    .map((message) => ({
      ...message,
      blocks: message.blocks.filter(usable).map((block): MessageBlock => {
        if (block.kind === "plan") return { ...block, status: planStatus.get(block.planId) ?? block.status };
        if (block.kind === "card") return answered.has(block.card.cardId) ? { ...block, card: { ...block.card, status: "answered" } } : block;
        if (block.kind === "card_response") return { ...block, text: cardResponseLabels(block.text) };
        return block;
      }),
    }))
    .filter((message) => message.blocks.length > 0);
}

/**
 * The notice a reopened conversation comes back with: a failed last turn
 * offers "Tentar de novo" (re-run on the server against the message it
 * saved), and a turn stopped at its budget or iteration cap (completed,
 * with an error) asks for another message to continue.
 */
export function resumeError(detail: Pick<ConversationDetail, "turns">, messages: ChatMessage[]): AssistantError | null {
  const last = [...detail.turns].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).at(-1);
  if (last?.status === "failed") {
    return { kind: "turn", code: "TURN_FAILED", message: last.error ?? "", retryable: messages.some((message) => message.role === "user") };
  }
  if (last?.status === "completed" && last.error) return { kind: "turn", code: TURN_LIMIT_CODE, message: last.error, retryable: false };
  return null;
}

// ---------------------------------------------------------------------------
// The last conversation, so ⌘K reopens it (a per-browser convenience)
// ---------------------------------------------------------------------------

export const LAST_CONVERSATION_KEY = "capital:assistant:last-conversation";

type KeyValueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function readLastConversation(storage: KeyValueStorage | null): string | null {
  try {
    const value = storage?.getItem(LAST_CONVERSATION_KEY) ?? null;
    return value && /^[\w-]{1,64}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

export function writeLastConversation(storage: KeyValueStorage | null, id: string | null): void {
  try {
    if (id) storage?.setItem(LAST_CONVERSATION_KEY, id);
    else storage?.removeItem(LAST_CONVERSATION_KEY);
  } catch {
    // Storage blocked: ⌘K starts a new conversation next time.
  }
}
