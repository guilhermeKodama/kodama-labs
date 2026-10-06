import type { AgentEvent } from "@capital/server/modules/assistant/agent/events";

/**
 * The assistant's reply arrives as Server-Sent Events on the response of
 * POST /api/v1/assistant/conversations/{id}/messages: `event: <type>` and
 * `data: <json>` lines, a blank line between frames (agent/events.ts has
 * the protocol). Chunks from the network can end anywhere, mid-line or
 * mid-frame, so the parser keeps the unfinished tail until the next push.
 */

export type { AgentEvent };

export interface SseFrame {
  /** The `event:` field; "message" when the frame has none. */
  event: string;
  /** The `data:` lines joined with "\n". */
  data: string;
}

export interface SseParser {
  /** Feeds a decoded chunk; returns the frames it completed. */
  push(chunk: string): SseFrame[];
  /** End of stream: the last frame, when it was not followed by a blank line. */
  flush(): SseFrame[];
}

export function createSseParser(): SseParser {
  let buffer = "";
  let event = "";
  let data: string[] = [];
  let hasData = false;

  const dispatch = (out: SseFrame[]) => {
    if (hasData) out.push({ event: event || "message", data: data.join("\n") });
    event = "";
    data = [];
    hasData = false;
  };

  const line = (text: string, out: SseFrame[]) => {
    if (text === "") {
      dispatch(out);
      return;
    }
    if (text.startsWith(":")) return; // comment / keep-alive
    const colon = text.indexOf(":");
    const field = colon === -1 ? text : text.slice(0, colon);
    let value = colon === -1 ? "" : text.slice(colon + 1);
    if (value.startsWith(" ")) value = value.slice(1);
    if (field === "event") event = value;
    else if (field === "data") {
      data.push(value);
      hasData = true;
    }
    // id and retry are not used by this protocol.
  };

  return {
    push(chunk) {
      const out: SseFrame[] = [];
      let text = buffer + chunk;
      // A trailing "\r" may be the first half of "\r\n": hold it until the next chunk.
      const heldCr = text.endsWith("\r");
      if (heldCr) text = text.slice(0, -1);
      // \r\n, \r and \n all end a line; the last piece is unfinished.
      const lines = text.split(/\r\n|\r|\n/);
      buffer = (lines.pop() ?? "") + (heldCr ? "\r" : "");
      for (const item of lines) line(item, out);
      return out;
    },
    flush() {
      const out: SseFrame[] = [];
      const rest = buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer;
      buffer = "";
      if (rest) line(rest, out);
      dispatch(out);
      return out;
    },
  };
}

const EVENT_TYPES: ReadonlySet<AgentEvent["type"]> = new Set([
  "turn_started",
  "message_created",
  "token",
  "tool_call_started",
  "tool_call_result",
  "action_card",
  "plan_proposed",
  "card_locked",
  "plan_committed",
  "message_complete",
  "turn_completed",
  "error",
]);

/** The agent event in a frame; null for anything this client does not know (skipped, the stream goes on). */
export function parseAgentEvent(frame: SseFrame): AgentEvent | null {
  let payload: unknown;
  try {
    payload = JSON.parse(frame.data);
  } catch {
    return null;
  }
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : frame.event;
  if (!EVENT_TYPES.has(type as AgentEvent["type"])) return null;
  return { ...record, type } as AgentEvent;
}

/**
 * Reads an SSE response body to the end, calling `onEvent` for each agent
 * event in order. Resolves when the server closes the stream; rejects
 * with the reader's error (an AbortError when `signal` aborts).
 */
export async function readAgentEvents(body: ReadableStream<Uint8Array>, onEvent: (event: AgentEvent) => void): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const emit = (frames: SseFrame[]) => {
    for (const frame of frames) {
      const event = parseAgentEvent(frame);
      if (event) onEvent(event);
    }
  };
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      emit(parser.push(decoder.decode(value, { stream: true })));
    }
    emit(parser.push(decoder.decode()));
    emit(parser.flush());
  } finally {
    reader.releaseLock();
  }
}
