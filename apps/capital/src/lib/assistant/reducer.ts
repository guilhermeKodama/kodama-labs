import type { ChatMessage, DuplicateReviewCard, ImportPlan, MessageAttachment, MessageBlock, PlanStatus } from "@/types/assistant";
import type { TurnLimitCode } from "@capital/server/modules/assistant/agent/events";
import type { AgentEvent } from "./sse";

/**
 * The assistant thread in ⌘K as a pure reducer: the messages of the open
 * conversation, built from the SSE events of each turn (sse.ts), plus the
 * turn's state and its error. The component dispatches what the network
 * does; everything shown is derived from here.
 */

/** What the user sends: text, files already uploaded, or the answer to a duplicates card. */
export interface AssistantInput {
  text?: string;
  /** Uploaded files (ids from POST …/files) shown under the bubble. */
  files?: MessageAttachment[];
  cardResponse?: { cardId: string; decisions: { pairId: string; label: string }[] };
}

export type AssistantError =
  /** The turn failed on the server (an `error` event or a failed turn). */
  | { kind: "turn"; code: string; message: string; retryable: boolean }
  /** The request itself failed (HTTP error or no connection), before the stream. */
  | { kind: "request"; status: number; code: string | null; params: Record<string, unknown> };

export type AssistantPhase = "idle" | "sending" | "streaming";

/**
 * The `error` code of a turn stopped by its budget or iteration cap
 * (agent/events.ts; typed against the server's constant so they cannot
 * drift): its work is kept and the user is asked to send another message.
 */
export const TURN_LIMIT_CODE: TurnLimitCode = "TURN_LIMIT";

/** The 409 of POST …/retry when the conversation has no failed turn to run again. */
const NOTHING_TO_RETRY_CODE = "assistant.nothing_to_retry";

/**
 * What "Tentar de novo" does: `rerun` runs the failed turn again on the
 * server against the message it already saved (POST …/retry); `resend`
 * sends the last input again, for a request that never reached the server.
 */
export type RetryKind = "rerun" | "resend";

export interface AssistantState {
  conversationId: string | null;
  title: string | null;
  messages: ChatMessage[];
  phase: AssistantPhase;
  error: AssistantError | null;
  /** The last thing sent, for "Tentar de novo" when its request failed. */
  lastInput: AssistantInput | null;
  /** What the last request was: a new message, or a re-run of a failed turn. */
  lastRequest: "send" | "rerun" | null;
  /** How the last turn ended (cancelled shows "Interrompido"). */
  lastTurn: "completed" | "failed" | "cancelled" | null;
}

export const initialAssistantState: AssistantState = {
  conversationId: null,
  title: null,
  messages: [],
  phase: "idle",
  error: null,
  lastInput: null,
  lastRequest: null,
  lastTurn: null,
};

export type AssistantAction =
  /** "Nova conversa". */
  | { type: "reset" }
  /** A conversation from the server (resume): its rebuilt messages. */
  | { type: "loaded"; conversationId: string; title: string | null; messages: ChatMessage[]; error?: AssistantError | null }
  /** The conversation was created for the first message. */
  | { type: "conversation"; conversationId: string; title: string | null }
  /** The user sent something: shown at once as a pending bubble. */
  | { type: "send"; input: AssistantInput; optimisticId: string; createdAt: string }
  /** "Tentar de novo" after a failed turn: the server runs it again; no new bubble. */
  | { type: "rerun" }
  | { type: "event"; event: AgentEvent }
  /** The request failed before streaming (HTTP error, offline). */
  | { type: "failed"; error: AssistantError }
  /** The user stopped the turn (the reader was aborted). */
  | { type: "cancelled" }
  /** The stream closed (normally after turn_completed; also when it was cut). */
  | { type: "ended" }
  /** A plan was confirmed or rejected from its card. */
  | { type: "plan_status"; planId: string; status: PlanStatus }
  /** The duplicates card was answered. */
  | { type: "card_answered"; cardId: string; decisions: Record<string, "keep_both" | "merge" | "skip"> };

function mapMessage(messages: ChatMessage[], id: string, update: (message: ChatMessage) => ChatMessage): ChatMessage[] {
  let changed = false;
  const next = messages.map((message) => {
    if (message.id !== id) return message;
    changed = true;
    return update(message);
  });
  return changed ? next : messages;
}

function mapBlocks(messages: ChatMessage[], update: (block: MessageBlock) => MessageBlock): ChatMessage[] {
  return messages.map((message) => {
    const blocks = message.blocks.map(update);
    return blocks.some((block, index) => block !== message.blocks[index]) ? { ...message, blocks } : message;
  });
}

function appendBlock(messages: ChatMessage[], messageId: string, block: MessageBlock): ChatMessage[] {
  return mapMessage(messages, messageId, (message) => ({ ...message, blocks: [...message.blocks, block] }));
}

/** Blocks of a user bubble for what was sent. */
export function inputBlocks(input: AssistantInput, cardLabels?: string): MessageBlock[] {
  if (input.cardResponse) return [{ kind: "card_response", text: cardLabels ?? input.cardResponse.decisions.map((d) => d.label).join(", ") }];
  const blocks: MessageBlock[] = [];
  if (input.text) blocks.push({ kind: "text", text: input.text });
  if (input.files?.length) blocks.push({ kind: "attachments", files: input.files });
  return blocks;
}

function isDuplicateCard(value: unknown): value is DuplicateReviewCard {
  if (typeof value !== "object" || value === null) return false;
  const card = value as Partial<DuplicateReviewCard>;
  return typeof card.cardId === "string" && card.cardType === "duplicate_review" && Array.isArray(card.pairs);
}

/** At the end of a turn: nothing is streaming any more, and assistant messages that got no block (only thinking, a cut stream) go away. */
function settle(messages: ChatMessage[]): ChatMessage[] {
  return messages
    .filter((message) => message.role !== "assistant" || message.blocks.length > 0)
    .map((message) => (message.status === "streaming" || message.status === "sending" ? { ...message, status: "complete" } : message));
}

function onEvent(state: AssistantState, event: AgentEvent): AssistantState {
  switch (event.type) {
    case "turn_started":
      return { ...state, phase: "streaming" };

    case "message_created": {
      const { message } = event;
      // The tool results sent back to the model: never a bubble.
      if (message.kind === "tool_results") return state;
      if (message.role === "user") {
        // The saved version of the pending bubble: same content, the server's id.
        const index = state.messages.findIndex((m) => m.role === "user" && m.status === "sending");
        if (index === -1) return state;
        const messages = [...state.messages];
        messages[index] = { ...messages[index], id: message.id, status: "complete", createdAt: message.createdAt };
        return { ...state, phase: "streaming", messages };
      }
      if (state.messages.some((m) => m.id === message.id)) return state;
      return {
        ...state,
        phase: "streaming",
        messages: [...state.messages, { id: message.id, role: "assistant", status: "streaming", createdAt: message.createdAt, blocks: [] }],
      };
    }

    case "token": {
      if (!event.delta) return state;
      return {
        ...state,
        messages: mapMessage(state.messages, event.messageId, (message) => {
          const last = message.blocks[message.blocks.length - 1];
          // Text after a tool call starts a new paragraph block, so the order is kept.
          const blocks: MessageBlock[] =
            last?.kind === "text" ? [...message.blocks.slice(0, -1), { kind: "text", text: last.text + event.delta }] : [...message.blocks, { kind: "text", text: event.delta }];
          return { ...message, blocks };
        }),
      };
    }

    case "tool_call_started":
      return {
        ...state,
        messages: appendBlock(state.messages, event.messageId, { kind: "tool", toolCallId: event.toolCallId, tool: event.tool, label: event.label, status: "running" }),
      };

    case "tool_call_result":
      return {
        ...state,
        messages: mapMessage(state.messages, event.messageId, (message) => ({
          ...message,
          blocks: message.blocks.map((block) => (block.kind === "tool" && block.toolCallId === event.toolCallId ? { ...block, status: event.status, summary: event.summary } : block)),
        })),
      };

    case "action_card":
      if (!isDuplicateCard(event.card)) return state;
      return { ...state, messages: appendBlock(state.messages, event.messageId, { kind: "card", card: { ...event.card, status: event.card.status ?? "pending" } }) };

    case "card_locked":
      return {
        ...state,
        messages: mapBlocks(state.messages, (block) =>
          block.kind === "card" && block.card.cardId === event.cardId ? { ...block, card: { ...block.card, status: "answered" } } : block,
        ),
      };

    case "plan_proposed": {
      // A new plan replaces the one still waiting for an answer (update_import_plan).
      const superseded = mapBlocks(state.messages, (block) => (block.kind === "plan" && block.status === "proposed" ? { ...block, status: "superseded" } : block));
      return {
        ...state,
        messages: appendBlock(superseded, event.messageId, {
          kind: "plan",
          planId: event.planId,
          planKind: event.kind,
          summary: (typeof event.summary === "object" && event.summary !== null ? event.summary : {}) as ImportPlan["summary"],
          payloadHash: event.payloadHash,
          warnings: Array.isArray(event.warnings) ? event.warnings : [],
          status: "proposed",
        }),
      };
    }

    case "plan_committed": {
      const result = (typeof event.result === "object" && event.result !== null ? event.result : {}) as Record<string, unknown>;
      const planKind = "transactionsDeleted" in result ? "revert" : event.kind;
      const committed = mapBlocks(state.messages, (block) => (block.kind === "plan" && block.planId === event.planId ? { ...block, status: "committed" } : block));
      return { ...state, messages: appendBlock(committed, event.messageId, { kind: "plan_result", planId: event.planId, planKind, result }) };
    }

    case "message_complete":
      return { ...state, messages: mapMessage(state.messages, event.messageId, (message) => ({ ...message, status: "complete" })) };

    case "error":
      return { ...state, error: { kind: "turn", code: event.code, message: event.message, retryable: event.retryable } };

    case "turn_completed": {
      const error =
        state.error ?? (event.status === "failed" ? ({ kind: "turn", code: "TURN_FAILED", message: "", retryable: true } satisfies AssistantError) : null);
      return { ...state, phase: "idle", messages: settle(state.messages), error, lastTurn: event.status };
    }

    default:
      return state;
  }
}

export function assistantReducer(state: AssistantState, action: AssistantAction): AssistantState {
  switch (action.type) {
    case "reset":
      return initialAssistantState;

    case "loaded":
      return {
        ...initialAssistantState,
        conversationId: action.conversationId,
        title: action.title,
        messages: action.messages,
        error: action.error ?? null,
      };

    case "conversation":
      return { ...state, conversationId: action.conversationId, title: state.title ?? action.title };

    case "send":
      return {
        ...state,
        phase: "sending",
        error: null,
        lastTurn: null,
        lastInput: action.input,
        lastRequest: "send",
        messages: [...state.messages, { id: action.optimisticId, role: "user", status: "sending", createdAt: action.createdAt, blocks: inputBlocks(action.input) }],
      };

    case "rerun":
      return { ...state, phase: "sending", error: null, lastTurn: null, lastRequest: "rerun" };

    case "event":
      return onEvent(state, action.event);

    case "failed":
      // The message never reached the server: its bubble goes, the text stays for "Tentar de novo".
      return { ...state, phase: "idle", error: action.error, messages: settle(state.messages.filter((m) => m.status !== "sending")) };

    case "cancelled":
      return { ...state, phase: "idle", lastTurn: "cancelled", messages: settle(state.messages) };

    case "ended":
      if (state.phase === "idle") return state;
      return { ...state, phase: "idle", messages: settle(state.messages) };

    case "plan_status":
      return {
        ...state,
        messages: mapBlocks(state.messages, (block) => (block.kind === "plan" && block.planId === action.planId ? { ...block, status: action.status } : block)),
      };

    case "card_answered":
      return {
        ...state,
        messages: mapBlocks(state.messages, (block) =>
          block.kind === "card" && block.card.cardId === action.cardId ? { ...block, card: { ...block.card, status: "answered", decisions: action.decisions } } : block,
        ),
      };

    default:
      return state;
  }
}

/** A turn is being sent or streamed: the composer shows "Parar". */
export function isBusy(state: AssistantState): boolean {
  return state.phase !== "idle";
}

/**
 * What "Tentar de novo" would do, or null when it is not offered. A turn
 * that failed on the server already saved the user's message, so it is
 * re-run there (sending the text again would show it twice); a request
 * that failed before reaching the server is repeated as it was.
 */
export function retryKind(state: AssistantState): RetryKind | null {
  if (!state.error || isBusy(state)) return null;
  if (state.error.kind === "turn") return state.error.retryable && state.conversationId ? "rerun" : null;
  // No failed turn left on the server (answered since, or it failed before saving the message): another re-run would only repeat the 409.
  if (state.error.code === NOTHING_TO_RETRY_CODE) return null;
  if (state.lastRequest === "rerun") return state.conversationId ? "rerun" : null;
  return state.lastInput ? "resend" : null;
}

export function canRetry(state: AssistantState): boolean {
  return retryKind(state) !== null;
}

/** The turn stopped at its budget or iteration cap: "send another message to continue". */
export function isTurnLimit(error: AssistantError | null): boolean {
  return error?.kind === "turn" && error.code === TURN_LIMIT_CODE;
}
