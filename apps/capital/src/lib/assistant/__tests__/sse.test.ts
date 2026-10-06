import { describe, expect, it } from "vitest";
import { createSseParser, parseAgentEvent, readAgentEvents, type AgentEvent } from "../sse";

function frame(event: AgentEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

describe("createSseParser", () => {
  it("reads event and data, a blank line ending each frame", () => {
    const parser = createSseParser();
    expect(parser.push('event: token\ndata: {"a":1}\n\nevent: x\ndata: 2\n\n')).toEqual([
      { event: "token", data: '{"a":1}' },
      { event: "x", data: "2" },
    ]);
  });

  it("keeps an unfinished frame until the rest arrives, even mid-line", () => {
    const parser = createSseParser();
    expect(parser.push("event: tok")).toEqual([]);
    expect(parser.push('en\ndata: {"de')).toEqual([]);
    expect(parser.push('lta":"oi"}\n')).toEqual([]);
    expect(parser.push("\n")).toEqual([{ event: "token", data: '{"delta":"oi"}' }]);
  });

  it("understands \\r\\n split across chunks, comments and multi-line data", () => {
    const parser = createSseParser();
    expect(parser.push(": keep-alive\r\nevent: e\r")).toEqual([]);
    expect(parser.push("\ndata: a\r\ndata: b\r\n\r")).toEqual([]);
    expect(parser.push("\n")).toEqual([{ event: "e", data: "a\nb" }]);
  });

  it("defaults the event name and ignores frames without data", () => {
    const parser = createSseParser();
    expect(parser.push("event: only\n\ndata: x\n\n")).toEqual([{ event: "message", data: "x" }]);
  });

  it("flushes a last frame with no blank line after it", () => {
    const parser = createSseParser();
    expect(parser.push("event: e\ndata: 1")).toEqual([]);
    expect(parser.flush()).toEqual([{ event: "e", data: "1" }]);
    expect(parser.flush()).toEqual([]);
  });
});

describe("parseAgentEvent", () => {
  it("returns the event, typed from its payload", () => {
    expect(parseAgentEvent({ event: "token", data: '{"type":"token","messageId":"m","delta":"a"}' })).toEqual({ type: "token", messageId: "m", delta: "a" });
  });

  it("takes the type from the frame when the payload has none", () => {
    expect(parseAgentEvent({ event: "message_complete", data: '{"messageId":"m"}' })).toEqual({ type: "message_complete", messageId: "m" });
  });

  it("skips bad JSON and unknown events", () => {
    expect(parseAgentEvent({ event: "token", data: "{oops" })).toBeNull();
    expect(parseAgentEvent({ event: "ping", data: '{"type":"ping"}' })).toBeNull();
    expect(parseAgentEvent({ event: "token", data: "[1]" })).toBeNull();
  });
});

describe("readAgentEvents", () => {
  it("delivers every event of a stream cut at arbitrary points, multi-byte text included", async () => {
    const events: AgentEvent[] = [
      { type: "turn_started", turnId: "t1" },
      { type: "token", messageId: "m1", delta: "Olá, João — R$ 1.234,56 ✓" },
      { type: "message_complete", messageId: "m1" },
    ];
    const text = events.map(frame).join("");
    const bytes = new TextEncoder().encode(text);
    // Split the bytes in 7-byte pieces, cutting through UTF-8 sequences.
    const chunks: Uint8Array[] = [];
    for (let i = 0; i < bytes.length; i += 7) chunks.push(bytes.slice(i, i + 7));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    });
    const seen: AgentEvent[] = [];
    await readAgentEvents(body, (event) => seen.push(event));
    expect(seen).toEqual(events);
  });

  it("delivers a final frame that has no trailing blank line", async () => {
    const seen: AgentEvent[] = [];
    await readAgentEvents(streamOf(['event: error\ndata: {"type":"error","code":"X","message":"m","retryable":false}']), (event) => seen.push(event));
    expect(seen).toEqual([{ type: "error", code: "X", message: "m", retryable: false }]);
  });
});
