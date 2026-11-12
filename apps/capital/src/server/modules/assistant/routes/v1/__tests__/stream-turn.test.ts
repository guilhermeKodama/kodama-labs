import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import type { AppBindings } from "@capital/server/types";
import type { AgentEvent, EmitFn } from "../../../agent/events";
import type { RunAgentTurnInput } from "../../../agent/loop";
import { runAgentTurn } from "../../../agent/loop";
import { streamTurn } from "../post-message";

/**
 * streamTurn turns the loop's `emit` calls into SSE frames. Hono's stream and
 * the loop are replaced so each rule can be observed on its own: frames keep
 * their order, are all flushed before the response closes, nothing is
 * written once the client has gone, and a loop that throws becomes an error
 * frame.
 */

interface FakeStream {
  writeSSE: ReturnType<typeof vi.fn>;
  onAbort: (listener: () => void) => void;
}

const sse = vi.hoisted(() => ({
  stream: null as unknown as FakeStream,
  aborts: [] as Array<() => void>,
  /** Frames as they finished writing: [event, data]. */
  written: [] as Array<[string, string]>,
  /** Resolves the callback streamSSE was given; the real helper closes the response then. */
  done: null as Promise<void> | null,
}));

vi.mock("hono/streaming", () => ({
  streamSSE: (_c: unknown, callback: (stream: FakeStream) => Promise<void>) => {
    sse.done = callback(sse.stream);
    return new Response(null);
  },
}));
vi.mock("../../../agent/loop", () => ({ runAgentTurn: vi.fn() }));

const context = {} as unknown as Context<AppBindings>;
const input: RunAgentTurnInput = { userId: "u1", conversationId: "c1", text: "oi" };

const started: AgentEvent = { type: "turn_started", turnId: "t1" };
const token = (delta: string): AgentEvent => ({ type: "token", messageId: "m1", delta });

async function run() {
  streamTurn(context, input);
  await sse.done;
}

beforeEach(() => {
  sse.written = [];
  sse.aborts = [];
  sse.stream = {
    writeSSE: vi.fn(async (frame: { event: string; data: string }) => {
      // A slow write: without chaining, later frames would overtake this one.
      await new Promise((resolve) => setTimeout(resolve, frame.event === "turn_started" ? 15 : 1));
      sse.written.push([frame.event, frame.data]);
    }),
    onAbort: (listener) => sse.aborts.push(listener),
  };
  vi.mocked(runAgentTurn).mockReset();
});

describe("streamTurn", () => {
  it("passes the input on to the loop", async () => {
    vi.mocked(runAgentTurn).mockResolvedValue(undefined);
    await run();
    expect(runAgentTurn).toHaveBeenCalledWith(input, expect.any(Function));
  });

  it("writes one frame per event with the event type and the event as JSON, in order, all flushed before it ends", async () => {
    vi.mocked(runAgentTurn).mockImplementation(async (_input, emit) => {
      emit(started);
      emit(token("a"));
      emit(token("b"));
    });

    await run();

    expect(sse.written).toEqual([
      ["turn_started", JSON.stringify(started)],
      ["token", JSON.stringify(token("a"))],
      ["token", JSON.stringify(token("b"))],
    ]);
  });

  it("keeps writing after a frame fails to write", async () => {
    vi.mocked(runAgentTurn).mockImplementation(async (_input, emit) => {
      emit(token("lost"));
      emit(token("kept"));
    });
    sse.stream.writeSSE.mockImplementationOnce(async () => {
      throw new Error("socket closed");
    });

    await run();

    expect(sse.written).toEqual([["token", JSON.stringify(token("kept"))]]);
  });

  it("writes nothing more once the client has gone", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    vi.mocked(runAgentTurn).mockImplementation(async (_input, emit) => {
      emit(started);
      await gate;
      emit(token("late"));
    });

    streamTurn(context, input);
    expect(sse.aborts).toHaveLength(1);
    sse.aborts[0]!();
    release();
    await sse.done;

    // The frame emitted before the abort was already queued; the late one never is.
    expect(sse.written.map(([event]) => event)).toEqual(["turn_started"]);
  });

  it("writes nothing once the response has been closed", async () => {
    let emitLater!: EmitFn;
    vi.mocked(runAgentTurn).mockImplementation(async (_input, emit) => {
      emitLater = emit;
      emit(started);
    });
    await run();
    expect(sse.written).toHaveLength(1);

    emitLater(token("after the end"));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(sse.written).toHaveLength(1);
  });

  it("turns a loop that throws into a retryable STREAM_FAILED error frame, after the frames already emitted", async () => {
    vi.mocked(runAgentTurn).mockImplementation(async (_input, emit) => {
      emit(started);
      throw new Error("database is down");
    });

    await run();

    expect(sse.written).toEqual([
      ["turn_started", JSON.stringify(started)],
      ["error", JSON.stringify({ type: "error", code: "STREAM_FAILED", message: "database is down", retryable: true })],
    ]);
  });

  it("reports a thrown value that is not an Error as an unknown error", async () => {
    vi.mocked(runAgentTurn).mockRejectedValue("just a string");

    await run();

    expect(sse.written).toEqual([
      ["error", JSON.stringify({ type: "error", code: "STREAM_FAILED", message: "Unknown error", retryable: true })],
    ]);
  });
});
