import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentTurnStatus } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { canRetryLastTurn } from "../retry-turn";

/**
 * canRetryLastTurn against real rows: "Tentar de novo" is offered only when
 * the last turn failed and the last thing the user wrote was never answered
 * by a turn that completed or was stopped. Timestamps are explicit so the
 * order of turns and messages is the one each test describes.
 */

const USER = "test-user-assistant-retry-turn-001";
const at = (minute: number) => new Date(Date.UTC(2026, 5, 1, 10, minute, 0));

async function conversation() {
  return (await prisma.agentConversation.create({ data: { userId: USER, title: "Retry" }, select: { id: true } })).id;
}

async function turn(conversationId: string, status: AgentTurnStatus, minute: number) {
  return (await prisma.agentTurn.create({ data: { conversationId, model: "claude-test", status, createdAt: at(minute) }, select: { id: true } })).id;
}

async function message(conversationId: string, kind: string, minute: number, turnId: string | null, role = "user") {
  await prisma.agentMessage.create({
    data: { conversationId, turnId, role, kind, content: [{ type: "text", text: kind }], createdAt: at(minute) },
  });
}

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@example.com`, passwordHash: "x", name: USER } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
});

describe("canRetryLastTurn", () => {
  it("is false for a conversation with no turn", async () => {
    const id = await conversation();
    await message(id, "user_text", 0, null);
    expect(await canRetryLastTurn(id, prisma)).toBe(false);
  });

  it("is false when the last turn failed but the user wrote nothing", async () => {
    const id = await conversation();
    await turn(id, "failed", 0);
    expect(await canRetryLastTurn(id, prisma)).toBe(false);
  });

  it("is true when the only turn failed after saving the user's message", async () => {
    const id = await conversation();
    const failed = await turn(id, "failed", 0);
    await message(id, "user_text", 1, failed);
    expect(await canRetryLastTurn(id, prisma)).toBe(true);
  });

  it("is true when a card answer is what the failed turn was answering", async () => {
    const id = await conversation();
    const failed = await turn(id, "failed", 0);
    await message(id, "card_response", 1, failed);
    expect(await canRetryLastTurn(id, prisma)).toBe(true);
  });

  it("is true after the re-run failed too: the message is still unanswered", async () => {
    const id = await conversation();
    const first = await turn(id, "failed", 0);
    await message(id, "user_text", 1, first);
    await turn(id, "failed", 2);
    expect(await canRetryLastTurn(id, prisma)).toBe(true);
  });

  it("is false when the last turn completed", async () => {
    const id = await conversation();
    const done = await turn(id, "completed", 0);
    await message(id, "user_text", 1, done);
    expect(await canRetryLastTurn(id, prisma)).toBe(false);
  });

  it("is false when the last turn is still running", async () => {
    const id = await conversation();
    const running = await turn(id, "running", 0);
    await message(id, "user_text", 1, running);
    expect(await canRetryLastTurn(id, prisma)).toBe(false);
  });

  it("is false when a later re-run completed, even if a still later turn failed", async () => {
    const id = await conversation();
    const first = await turn(id, "failed", 0);
    await message(id, "user_text", 1, first);
    await turn(id, "completed", 2);
    await turn(id, "failed", 3);
    expect(await canRetryLastTurn(id, prisma)).toBe(false);
  });

  it("is false when a later turn was cancelled", async () => {
    const id = await conversation();
    const first = await turn(id, "failed", 0);
    await message(id, "user_text", 1, first);
    await turn(id, "cancelled", 2);
    await turn(id, "failed", 3);
    expect(await canRetryLastTurn(id, prisma)).toBe(false);
  });

  it("is false when the turn that saved the message is itself the one that completed", async () => {
    const id = await conversation();
    const done = await turn(id, "completed", 0);
    await message(id, "user_text", 1, done);
    await turn(id, "failed", 2);
    // The failed turn after it answers nothing new: the message already has an answer.
    expect(await canRetryLastTurn(id, prisma)).toBe(false);
  });

  it("ignores the tool results the loop sends back to the model", async () => {
    const id = await conversation();
    const failed = await turn(id, "failed", 0);
    await message(id, "tool_results", 1, failed);
    await message(id, "assistant", 2, failed, "assistant");
    expect(await canRetryLastTurn(id, prisma)).toBe(false);
  });

  it("reads the last user message when the user wrote more than once", async () => {
    const id = await conversation();
    const first = await turn(id, "completed", 0);
    await message(id, "user_text", 1, first);
    const second = await turn(id, "failed", 5);
    await message(id, "user_text", 6, second);
    expect(await canRetryLastTurn(id, prisma)).toBe(true);
  });

  it("works for a message whose turn was deleted: only later completed turns answer it", async () => {
    const detached = await conversation();
    await message(detached, "user_text", 1, null);
    await turn(detached, "failed", 2);
    expect(await canRetryLastTurn(detached, prisma)).toBe(true);

    const answered = await conversation();
    await message(answered, "user_text", 1, null);
    await turn(answered, "completed", 2);
    await turn(answered, "failed", 3);
    expect(await canRetryLastTurn(answered, prisma)).toBe(false);
  });
});
