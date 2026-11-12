import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { MAX_TOOL_ITERATIONS_DEFAULT } from "../../constants";
import { runAgentTurn } from "../loop";
import type { AgentEvent } from "../events";

/**
 * When the environment sets no limits (the optional settings are absent),
 * a turn falls back to the defaults in constants.ts: 12 rounds of tools. The
 * environment is replaced so both limits are undefined; the model keeps asking
 * for a tool that does not exist, which is the cheapest round there is.
 */

const model = vi.hoisted(() => ({ requests: 0 }));

vi.mock("@/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/env")>();
  const env = new Proxy(actual.env, {
    get(target, key, receiver) {
      if (key === "ASSISTANT_MAX_TOOL_ITERATIONS" || key === "ASSISTANT_MAX_TURN_COST_USD") return undefined;
      return Reflect.get(target, key, receiver);
    },
  });
  return { ...actual, env };
});

vi.mock("@capital/server/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capital/server/lib/anthropic")>();
  const client = {
    messages: {
      stream: () => {
        model.requests++;
        return {
          on: () => undefined,
          finalMessage: async () => ({
            content: [{ type: "tool_use", id: `tu${model.requests}`, name: "not_a_real_tool", input: {} }],
            usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
          }),
        };
      },
      create: async () => ({ content: [{ type: "text", text: "Título" }] }),
    },
  };
  return { ...actual, getAnthropicClient: () => client };
});

const USER = "test-user-assistant-loop-defaults-001";
let conversationId: string;

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@example.com`, passwordHash: "x", name: USER } });
  conversationId = (await prisma.agentConversation.create({ data: { userId: USER, title: "Limites" }, select: { id: true } })).id;
});

beforeEach(() => {
  model.requests = 0;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
});

describe("a turn with no limits configured", () => {
  it("stops after the default number of rounds and says so", async () => {
    const events: AgentEvent[] = [];

    await runAgentTurn({ userId: USER, conversationId, text: "continue" }, (event) => events.push(event));

    expect(MAX_TOOL_ITERATIONS_DEFAULT).toBe(12);
    expect(model.requests).toBe(MAX_TOOL_ITERATIONS_DEFAULT);
    expect(events.filter((event) => event.type === "error")).toEqual([
      { type: "error", code: "TURN_LIMIT", message: expect.stringContaining("Limite de iterações"), retryable: false },
    ]);
    const saved = await prisma.agentTurn.findFirstOrThrow({ where: { conversationId } });
    expect(saved).toMatchObject({ status: "completed", iterations: MAX_TOOL_ITERATIONS_DEFAULT });
  });
});
