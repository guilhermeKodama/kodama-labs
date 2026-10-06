import { apiGet, apiPost, apiUpload, ApiError, NETWORK_STATUS, parseApiError } from "@/lib/api/client";
import type { ConversationFile, ConversationSummary } from "@/types/assistant";
import type { ConversationDetail } from "./history";
import type { AssistantError, AssistantInput } from "./reducer";
import { readAgentEvents, type AgentEvent } from "./sse";

/**
 * The assistant's v1 API (src/server/modules/assistant/routes/v1), for the
 * ⌘K assistant. Plain functions; the hook in components/shell/assistant
 * calls them and feeds the reducer.
 */

const BASE = "/api/v1/assistant/conversations";

export function createConversation(title: string | undefined): Promise<ConversationSummary> {
  return apiPost<ConversationSummary>(BASE, title ? { title } : {});
}

export function listConversations(limit = 20): Promise<ConversationSummary[]> {
  return apiGet<ConversationSummary[]>(BASE, { limit });
}

export function getConversation(id: string): Promise<ConversationDetail> {
  return apiGet<ConversationDetail>(`${BASE}/${encodeURIComponent(id)}`);
}

export function uploadConversationFile(conversationId: string, file: File): Promise<ConversationFile> {
  const form = new FormData();
  form.append("file", file);
  return apiUpload<ConversationFile>(`${BASE}/${encodeURIComponent(conversationId)}/files`, form);
}

export function cancelTurn(conversationId: string): Promise<unknown> {
  return apiPost(`${BASE}/${encodeURIComponent(conversationId)}/cancel`);
}

export function confirmPlan(conversationId: string, planId: string, payloadHash: string): Promise<{ planId: string; status: string }> {
  return apiPost(`${BASE}/${encodeURIComponent(conversationId)}/plans/${encodeURIComponent(planId)}/confirm`, { payloadHash });
}

export function rejectPlan(conversationId: string, planId: string): Promise<{ planId: string; status: string }> {
  return apiPost(`${BASE}/${encodeURIComponent(conversationId)}/plans/${encodeURIComponent(planId)}/reject`);
}

/** The body of POST …/messages for an input (files already uploaded). */
export function messageBody(input: AssistantInput, clientMessageId: string) {
  return {
    ...(input.text ? { text: input.text } : {}),
    ...(input.files?.length ? { fileIds: input.files.map((file) => file.fileId) } : {}),
    ...(input.cardResponse ? { cardResponse: input.cardResponse } : {}),
    clientMessageId,
  };
}

/**
 * Sends a message and streams the turn: resolves when the server closes
 * the stream. An answer that is not a stream (409 turn_running, 404, 422)
 * throws an ApiError before any event; an abort rethrows the AbortError.
 */
export async function streamMessage(
  conversationId: string,
  body: ReturnType<typeof messageBody>,
  onEvent: (event: AgentEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${encodeURIComponent(conversationId)}/messages`, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ApiError({ status: NETWORK_STATUS, code: "network", message: error instanceof Error ? error.message : String(error) });
  }
  if (!res.ok || !res.body) {
    const raw = await res.text().catch(() => "");
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      // Not JSON: the status is enough.
    }
    throw parseApiError(res.status, parsed, res.statusText);
  }
  await readAgentEvents(res.body, onEvent);
}

/** The reducer's error for a request that failed before streaming. */
export function requestError(error: unknown): AssistantError {
  if (error instanceof ApiError) return { kind: "request", status: error.status, code: error.code, params: error.params };
  return { kind: "request", status: NETWORK_STATUS, code: "network", params: {} };
}
