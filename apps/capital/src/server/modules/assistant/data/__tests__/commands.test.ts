import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { insertAgentAction } from "../commands/insert-agent-action";
import { insertAgentMessage, updateAgentMessageContent } from "../commands/insert-agent-message";
import { insertConversation } from "../commands/insert-conversation";
import { insertConversationFile } from "../commands/insert-conversation-file";
import { insertImportPlan } from "../commands/insert-import-plan";
import { fetchAgentTurnStatus, insertAgentTurn, updateAgentTurn } from "../commands/manage-agent-turn";
import { archiveConversationRow, touchConversation, updateConversationTitle } from "../commands/update-conversation";
import { updateImportPlanPayload, updateImportPlanStatus } from "../commands/update-import-plan";

const USER = "test-user-assistant-data-commands";
const OTHER = "test-user-assistant-data-commands-other";

const csvPayload = { kind: "card_csv" as const, rows: [{ date: "2026-01-01", description: "Padaria", amount: 12, isPayment: false }] };

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
  for (const id of [USER, OTHER]) {
    await prisma.user.create({ data: { id, email: `${id}@example.com`, passwordHash: "x", name: id } });
  }
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
});

async function expectLedgerError(promise: Promise<unknown>, status: number, code: string) {
  const error = await promise.then(
    () => null,
    (e: unknown) => e
  );
  expect(error).toBeInstanceOf(LedgerError);
  expect(error).toMatchObject({ status, code });
}

describe("conversations", () => {
  it("creates a conversation for the user, titled or not, active by default", async () => {
    const titled = await insertConversation(USER, { title: "Extrato de agosto" }, prisma);
    expect(titled).toMatchObject({ userId: USER, title: "Extrato de agosto", status: "active" });
    const untitled = await insertConversation(USER, {}, prisma);
    expect(untitled.title).toBeNull();
    expect(await prisma.agentConversation.count({ where: { userId: USER } })).toBeGreaterThanOrEqual(2);
  });

  it("renames, archives and touches a conversation, but only for its owner", async () => {
    const conversation = await insertConversation(USER, { title: "Antigo" }, prisma);

    const renamed = await updateConversationTitle(USER, conversation.id, "Novo titulo", prisma);
    expect(renamed.title).toBe("Novo titulo");
    expect((await prisma.agentConversation.findUniqueOrThrow({ where: { id: conversation.id } })).title).toBe("Novo titulo");

    await expectLedgerError(updateConversationTitle(OTHER, conversation.id, "Roubado", prisma), 404, "assistant.conversation_not_found");
    await expectLedgerError(archiveConversationRow(OTHER, conversation.id, prisma), 404, "assistant.conversation_not_found");
    await expectLedgerError(updateConversationTitle(USER, "missing-id", "x", prisma), 404, "assistant.conversation_not_found");
    expect((await prisma.agentConversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe("active");

    const before = (await prisma.agentConversation.findUniqueOrThrow({ where: { id: conversation.id } })).lastMessageAt;
    await new Promise((resolve) => setTimeout(resolve, 15));
    const touched = await touchConversation(conversation.id, prisma);
    expect(touched.lastMessageAt.getTime()).toBeGreaterThan(before.getTime());

    const archived = await archiveConversationRow(USER, conversation.id, prisma);
    expect(archived.status).toBe("archived");
    expect((await prisma.agentConversation.findUniqueOrThrow({ where: { id: conversation.id } })).status).toBe("archived");
  });
});

describe("messages and turns", () => {
  let conversationId: string;

  beforeAll(async () => {
    conversationId = (await insertConversation(USER, { title: "Turnos" }, prisma)).id;
  });

  it("persists a message and later fills in its content", async () => {
    const turn = await insertAgentTurn(conversationId, "claude-test", prisma);
    const empty = await insertAgentMessage({ conversationId, turnId: turn.id, role: "assistant", content: [], kind: "assistant" }, prisma);
    expect(empty).toMatchObject({ conversationId, turnId: turn.id, role: "assistant", kind: "assistant", content: [] });

    const filled = await updateAgentMessageContent(empty.id, [{ type: "text", text: "Pronto" }], prisma);
    expect(filled.content).toEqual([{ type: "text", text: "Pronto" }]);
    expect((await prisma.agentMessage.findUniqueOrThrow({ where: { id: empty.id } })).content).toEqual([{ type: "text", text: "Pronto" }]);

    const withoutTurn = await insertAgentMessage({ conversationId, role: "user", content: [{ type: "text", text: "oi" }], kind: "user_text" }, prisma);
    expect(withoutTurn.turnId).toBeNull();
  });

  it("starts a turn running, updates its totals and reports its status", async () => {
    const turn = await insertAgentTurn(conversationId, "claude-test", prisma);
    expect(turn).toMatchObject({ conversationId, model: "claude-test", status: "running", iterations: 0 });
    expect(await fetchAgentTurnStatus(turn.id, prisma)).toBe("running");

    const completedAt = new Date();
    const updated = await updateAgentTurn(turn.id, { status: "completed", iterations: 3, inputTokens: 100, outputTokens: 40, cacheCreationInputTokens: 5, cacheReadInputTokens: 7, costUsd: 0.0421, durationMs: 1234, completedAt }, prisma);
    expect(updated).toMatchObject({ status: "completed", iterations: 3, inputTokens: 100, outputTokens: 40, cacheCreationInputTokens: 5, cacheReadInputTokens: 7, durationMs: 1234, completedAt });
    expect(Number(updated.costUsd)).toBeCloseTo(0.0421, 6);
    expect(await fetchAgentTurnStatus(turn.id, prisma)).toBe("completed");

    const failed = await updateAgentTurn(turn.id, { status: "failed", error: "boom" }, prisma);
    expect(failed).toMatchObject({ status: "failed", error: "boom", iterations: 3 });
  });

  it("has no status for a turn that does not exist", async () => {
    expect(await fetchAgentTurnStatus("missing-turn", prisma)).toBeNull();
  });

  it("audits a tool call with its created records, and a failed one with its error", async () => {
    const ok = await insertAgentAction(
      { userId: USER, conversationId, toolName: "manage_credit_card", input: { action: "create" }, output: { card: { id: "c1" } }, status: "success", createdRecords: [{ model: "Account", id: "c1" }], durationMs: 12 },
      prisma
    );
    expect(ok).toMatchObject({ toolName: "manage_credit_card", status: "success", input: { action: "create" }, output: { card: { id: "c1" } }, createdRecords: [{ model: "Account", id: "c1" }], durationMs: 12, error: null, turnId: null, planId: null });

    const failed = await insertAgentAction({ userId: USER, conversationId, toolName: "commit_plan", input: {}, status: "error", error: "nope", durationMs: 1 }, prisma);
    expect(failed).toMatchObject({ status: "error", error: "nope", output: null, createdRecords: null });
  });
});

describe("conversation files", () => {
  const fileInput = (conversationId: string) => ({
    conversationId,
    fileType: "csv" as const,
    statementKind: "card_csv",
    blobUrl: "blob://fatura.csv",
    pathname: "fatura.csv",
    mimeType: "text/csv",
    sizeBytes: 321,
    originalName: "fatura.csv",
    parseStatus: "parsed" as const,
  });

  it("stores an upload with its parsed rows in the owner's conversation", async () => {
    const conversationId = (await insertConversation(USER, { title: "Upload" }, prisma)).id;
    const file = await insertConversationFile(USER, { ...fileInput(conversationId), parsedPayload: csvPayload }, prisma);
    expect(file).toMatchObject({ conversationId, userId: USER, fileType: "csv", statementKind: "card_csv", sizeBytes: 321, originalName: "fatura.csv", parseStatus: "parsed", parsedPayload: csvPayload, parseError: null });

    const failed = await insertConversationFile(USER, { ...fileInput(conversationId), parseStatus: "failed", parseError: "formato invalido" }, prisma);
    expect(failed).toMatchObject({ parseStatus: "failed", parseError: "formato invalido", parsedPayload: null });
  });

  it("refuses an upload into somebody else's or a missing conversation, writing nothing", async () => {
    const theirs = (await insertConversation(OTHER, { title: "Alheia" }, prisma)).id;
    await expectLedgerError(insertConversationFile(USER, fileInput(theirs), prisma), 404, "assistant.conversation_not_found");
    await expectLedgerError(insertConversationFile(USER, fileInput("missing-conversation"), prisma), 404, "assistant.conversation_not_found");
    expect(await prisma.conversationFile.count({ where: { conversationId: theirs } })).toBe(0);
  });
});

describe("import plans", () => {
  let conversationId: string;
  const plan = (n: number) => ({
    conversationId,
    kind: "import" as const,
    entityType: "personal" as const,
    entityId: "entity-1",
    payload: { n },
    payloadHash: `hash-${n}`,
    summary: { count: n },
    warnings: [`warning ${n}`],
  });

  beforeAll(async () => {
    conversationId = (await insertConversation(USER, { title: "Planos" }, prisma)).id;
  });

  it("saves a proposal and supersedes only the previous open proposal of the same conversation", async () => {
    const first = await insertImportPlan(USER, plan(1), prisma);
    expect(first).toMatchObject({ status: "proposed", kind: "import", entityType: "personal", entityId: "entity-1", payload: { n: 1 }, payloadHash: "hash-1", summary: { count: 1 }, warnings: ["warning 1"], fileId: null });

    const committed = await prisma.importPlan.create({ data: { conversationId, userId: USER, status: "committed", payload: {}, payloadHash: "c", summary: {} } });
    const otherConversation = (await insertConversation(USER, { title: "Outra" }, prisma)).id;
    const elsewhere = await insertImportPlan(USER, { ...plan(9), conversationId: otherConversation }, prisma);

    const second = await insertImportPlan(USER, plan(2), prisma);
    expect(second.status).toBe("proposed");
    const status = async (id: string) => (await prisma.importPlan.findUniqueOrThrow({ where: { id } })).status;
    expect(await status(first.id)).toBe("superseded");
    expect(await status(committed.id)).toBe("committed");
    expect(await status(elsewhere.id)).toBe("proposed");
    expect(await status(second.id)).toBe("proposed");
  });

  it("amends a proposed plan and refuses any other state or a stranger's plan", async () => {
    const proposed = await insertImportPlan(USER, plan(3), prisma);
    const amended = await updateImportPlanPayload(USER, proposed.id, { payload: { n: 33 }, payloadHash: "hash-33", summary: { count: 33 }, warnings: [] }, prisma);
    expect(amended).toMatchObject({ payload: { n: 33 }, payloadHash: "hash-33", summary: { count: 33 }, warnings: [], status: "proposed" });

    await expectLedgerError(updateImportPlanPayload(OTHER, proposed.id, { payload: {}, payloadHash: "x", summary: {}, warnings: [] }, prisma), 404, "assistant.plan_not_found");
    await expectLedgerError(updateImportPlanPayload(USER, "missing-plan", { payload: {}, payloadHash: "x", summary: {}, warnings: [] }, prisma), 404, "assistant.plan_not_found");

    await prisma.importPlan.update({ where: { id: proposed.id }, data: { status: "confirmed" } });
    await expect(updateImportPlanPayload(USER, proposed.id, { payload: {}, payloadHash: "x", summary: {}, warnings: [] }, prisma)).rejects.toThrow('Plan is "confirmed" - only a "proposed" plan can be amended');
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: proposed.id } })).payloadHash).toBe("hash-33");
  });

  it("moves a plan to a new status with its timestamps, only for its owner", async () => {
    const proposed = await insertImportPlan(USER, plan(4), prisma);
    const confirmedAt = new Date("2026-06-01T10:00:00Z");
    const confirmed = await updateImportPlanStatus(USER, proposed.id, "confirmed", { confirmedAt, confirmedVia: "ui_button" }, prisma);
    expect(confirmed).toMatchObject({ status: "confirmed", confirmedAt, confirmedVia: "ui_button", committedAt: null });

    const committedAt = new Date("2026-06-01T10:05:00Z");
    const committed = await updateImportPlanStatus(USER, proposed.id, "committed", { committedAt }, prisma);
    expect(committed).toMatchObject({ status: "committed", committedAt, confirmedVia: "ui_button" });

    const reverted = await updateImportPlanStatus(USER, proposed.id, "reverted", undefined, prisma);
    expect(reverted.status).toBe("reverted");

    await expectLedgerError(updateImportPlanStatus(OTHER, proposed.id, "rejected", {}, prisma), 404, "assistant.plan_not_found");
    await expectLedgerError(updateImportPlanStatus(USER, "missing-plan", "rejected", {}, prisma), 404, "assistant.plan_not_found");
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: proposed.id } })).status).toBe("reverted");
  });
});
