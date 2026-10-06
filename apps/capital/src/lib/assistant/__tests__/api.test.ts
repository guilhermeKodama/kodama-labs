import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/api/client";
import { messageBody, requestError, streamRetry } from "../api";
import type { AgentEvent } from "../sse";

describe("messageBody", () => {
  it("sends only what the input has", () => {
    expect(messageBody({ text: "oi" }, "c1")).toEqual({ text: "oi", clientMessageId: "c1" });
    expect(messageBody({ files: [{ fileId: "f1", originalName: "extrato.ofx" }] }, "c2")).toEqual({ fileIds: ["f1"], clientMessageId: "c2" });
    const cardResponse = { cardId: "k1", decisions: [{ pairId: "p1", label: "Pular" }] };
    expect(messageBody({ cardResponse }, "c3")).toEqual({ cardResponse, clientMessageId: "c3" });
  });
});

describe("requestError", () => {
  it("keeps the code of an API error, for the localized message", () => {
    const error = new ApiError({ status: 409, code: "assistant.turn_running", message: "busy", params: { a: 1 } });
    expect(requestError(error)).toEqual({ kind: "request", status: 409, code: "assistant.turn_running", params: { a: 1 } });
  });

  it("treats anything else as a network failure", () => {
    expect(requestError(new TypeError("Failed to fetch"))).toEqual({ kind: "request", status: 0, code: "network", params: {} });
  });
});

describe("streamRetry", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("asks the server to re-run the failed turn, sending no message, and streams its events", async () => {
    const frames = 'event: turn_started\ndata: {"type":"turn_started","turnId":"t2"}\n\n';
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => new Response(frames, { status: 200, headers: { "content-type": "text/event-stream" } }));
    vi.stubGlobal("fetch", fetchMock);
    const events: AgentEvent[] = [];
    await streamRetry("conv 1", (event) => events.push(event));
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/assistant/conversations/conv%201/retry");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({});
    expect(events).toEqual([{ type: "turn_started", turnId: "t2" }]);
  });

  it("throws the coded error when there is nothing to retry", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ message: "x", code: "assistant.nothing_to_retry" }), { status: 409 }));
    await expect(streamRetry("c", () => undefined)).rejects.toMatchObject({ status: 409, code: "assistant.nothing_to_retry" });
  });
});
