import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import { createSseParser, parseAgentEvent } from "@/lib/assistant/sse";
import { runAgentTurn } from "../agent/loop";
import type { AgentEvent } from "../agent/events";

/**
 * The agent loop against a scripted model (no network): a turn stopped by
 * its budget or iteration cap says so with an `error` event, and
 * POST …/retry re-runs a failed turn against the user message it saved,
 * without saving that message a second time.
 */

type Reply = { content: unknown[]; usage?: Partial<Anthropic.Usage> } | Error;

const model = vi.hoisted(() => ({
  replies: [] as Reply[],
  /** The `messages` of every stream call, as sent. */
  requests: [] as unknown[][],
}));

vi.mock("@capital/server/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capital/server/lib/anthropic")>();
  const client = {
    messages: {
      stream(params: { messages: unknown[] }) {
        model.requests.push(JSON.parse(JSON.stringify(params.messages)));
        const reply = model.replies.shift() ?? { content: [{ type: "text", text: "ok" }] };
        return {
          on: () => undefined,
          finalMessage: async () => {
            if (reply instanceof Error) throw reply;
            return {
              content: reply.content,
              usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...reply.usage },
            };
          },
        };
      },
      create: async () => ({ content: [{ type: "text", text: "Título" }] }),
    },
  };
  return { ...actual, getAnthropicClient: () => client };
});

const USER = "test-user-f4-assistant-retry-001";
const app = createApp();
let cookie: string;

const toolUse = (id: string) => ({ content: [{ type: "tool_use", id, name: "not_a_real_tool", input: {} }] });

async function newConversation(): Promise<string> {
  const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "Teste" }, select: { id: true } });
  return conversation.id;
}

async function turn(conversationId: string, text: string): Promise<AgentEvent[]> {
  const events: AgentEvent[] = [];
  await runAgentTurn({ userId: USER, conversationId, text }, (event) => events.push(event));
  return events;
}

async function post(path: string, body: unknown = {}): Promise<{ status: number; events: AgentEvent[]; json: unknown }> {
  const res = await app.request(`/api${path}`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify(body) });
  const text = await res.text();
  if (!res.headers.get("content-type")?.includes("text/event-stream")) return { status: res.status, events: [], json: JSON.parse(text) };
  const parser = createSseParser();
  const events = [...parser.push(text), ...parser.flush()].map(parseAgentEvent).filter((event): event is AgentEvent => event !== null);
  return { status: res.status, events, json: null };
}

const errors = (events: AgentEvent[]) => events.filter((event) => event.type === "error");
const completed = (events: AgentEvent[]) => events.find((event) => event.type === "turn_completed");

beforeAll(async () => {
  await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

beforeEach(() => {
  model.replies = [];
  model.requests = [];
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("a turn stopped short", () => {
  it("at the cost budget emits a non-retryable TURN_LIMIT error and still completes", async () => {
    const conversationId = await newConversation();
    // One round of output that costs more than the budget on its own (output is at least US$ 5 per million tokens).
    model.replies = [{ ...toolUse("tu1"), usage: { output_tokens: Math.ceil(env.ASSISTANT_MAX_TURN_COST_USD * 1_000_000) } }];
    const events = await turn(conversationId, "importe tudo");

    expect(errors(events)).toEqual([{ type: "error", code: "TURN_LIMIT", message: expect.stringContaining("envie outra mensagem para continuar"), retryable: false }]);
    expect(completed(events)).toMatchObject({ status: "completed" });
    expect(model.requests).toHaveLength(1);
    const saved = await prisma.agentTurn.findFirstOrThrow({ where: { conversationId } });
    expect(saved).toMatchObject({ status: "completed", iterations: 1, error: expect.stringContaining("Orçamento") });
  });

  it("at the iteration cap emits TURN_LIMIT", async () => {
    const conversationId = await newConversation();
    const cap = env.ASSISTANT_MAX_TOOL_ITERATIONS;
    model.replies = Array.from({ length: cap + 1 }, (_, i) => toolUse(`tu${i}`));
    const events = await turn(conversationId, "continue");

    expect(model.requests).toHaveLength(cap);
    expect(errors(events)).toEqual([{ type: "error", code: "TURN_LIMIT", message: expect.stringContaining("Limite de iterações"), retryable: false }]);
    expect(completed(events)).toMatchObject({ status: "completed" });
  });

  it("does not report a limit when the last allowed round is the answer", async () => {
    const conversationId = await newConversation();
    const cap = env.ASSISTANT_MAX_TOOL_ITERATIONS;
    model.replies = [...Array.from({ length: cap - 1 }, (_, i) => toolUse(`tu${i}`)), { content: [{ type: "text", text: "Pronto." }] }];
    const events = await turn(conversationId, "continue");

    expect(model.requests).toHaveLength(cap);
    expect(errors(events)).toEqual([]);
    const saved = await prisma.agentTurn.findFirstOrThrow({ where: { conversationId } });
    expect(saved).toMatchObject({ status: "completed", error: null });
  });
});

describe("POST /v1/assistant/conversations/:id/retry", () => {
  it("re-runs a failed turn against the saved message, without saving it again", async () => {
    const conversationId = await newConversation();
    model.replies = [new Error("credit balance is too low")];
    const first = await post(`/v1/assistant/conversations/${conversationId}/messages`, { text: "importe o extrato" });
    expect(errors(first.events)).toEqual([{ type: "error", code: "TURN_FAILED", message: "credit balance is too low", retryable: true }]);
    expect(completed(first.events)).toMatchObject({ status: "failed" });

    model.replies = [{ content: [{ type: "text", text: "Importei." }] }];
    const retried = await post(`/v1/assistant/conversations/${conversationId}/retry`);
    expect(retried.status).toBe(200);
    expect(errors(retried.events)).toEqual([]);
    expect(completed(retried.events)).toMatchObject({ status: "completed" });
    // No user message is created by the re-run.
    expect(retried.events.filter((event) => event.type === "message_created" && event.message.role === "user")).toEqual([]);

    const userRows = await prisma.agentMessage.findMany({ where: { conversationId, kind: "user_text" } });
    expect(userRows.map((row) => row.content)).toEqual([[{ type: "text", text: "importe o extrato" }]]);

    // The model got the saved message once, and not the empty placeholder the failed stream left behind.
    const sent = model.requests.at(-1) as { role: string; content: unknown[] }[];
    expect(sent).toEqual([{ role: "user", content: [{ type: "text", text: "importe o extrato" }] }]);

    // Answered now: nothing left to retry.
    const again = await post(`/v1/assistant/conversations/${conversationId}/retry`);
    expect(again).toMatchObject({ status: 409, json: { code: "assistant.nothing_to_retry" } });
  });

  it("can retry again after the re-run fails too", async () => {
    const conversationId = await newConversation();
    model.replies = [new Error("overloaded")];
    await post(`/v1/assistant/conversations/${conversationId}/messages`, { text: "oi" });
    model.replies = [new Error("overloaded")];
    expect(completed((await post(`/v1/assistant/conversations/${conversationId}/retry`)).events)).toMatchObject({ status: "failed" });
    model.replies = [{ content: [{ type: "text", text: "Olá." }] }];
    expect(completed((await post(`/v1/assistant/conversations/${conversationId}/retry`)).events)).toMatchObject({ status: "completed" });
    expect(await prisma.agentMessage.count({ where: { conversationId, kind: "user_text" } })).toBe(1);
  });

  it("refuses when the last turn did not fail", async () => {
    const empty = await newConversation();
    expect(await post(`/v1/assistant/conversations/${empty}/retry`)).toMatchObject({ status: 409, json: { code: "assistant.nothing_to_retry" } });

    const answered = await newConversation();
    await post(`/v1/assistant/conversations/${answered}/messages`, { text: "oi" });
    expect(await post(`/v1/assistant/conversations/${answered}/retry`)).toMatchObject({ status: 409, json: { code: "assistant.nothing_to_retry" } });

    // A turn stopped at its budget completed: the user sends another message instead.
    const limited = await newConversation();
    model.replies = [{ ...toolUse("tu1"), usage: { output_tokens: Math.ceil(env.ASSISTANT_MAX_TURN_COST_USD * 1_000_000) } }];
    await post(`/v1/assistant/conversations/${limited}/messages`, { text: "importe tudo" });
    expect(await post(`/v1/assistant/conversations/${limited}/retry`)).toMatchObject({ status: 409, json: { code: "assistant.nothing_to_retry" } });
  });

  it("is 404 for a conversation of someone else", async () => {
    expect(await post(`/v1/assistant/conversations/00000000-0000-0000-0000-000000000000/retry`)).toMatchObject({
      status: 404,
      json: { code: "assistant.conversation_not_found" },
    });
  });
});
