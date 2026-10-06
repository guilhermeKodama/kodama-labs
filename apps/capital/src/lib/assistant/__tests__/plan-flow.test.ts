import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExecuteImportResult } from "@capital/server/modules/bank-statements/services/execute-import";
import { confirmPlan, messageBody, rejectPlan, streamMessage } from "../api";
import { importRowsHref, planResultView } from "../cards";
import { assistantReducer, initialAssistantState, type AssistantAction, type AssistantState } from "../reducer";
import type { AgentEvent } from "../sse";

/**
 * The whole confirm flow of an import plan, as use-assistant.ts drives it,
 * over a stubbed fetch: a recorded turn proposes the plan, the card's
 * Confirmar posts the exact payloadHash to the confirm route, and the
 * follow-up turn's plan_committed (commit_plan's real result shape) turns
 * into the result card with Desfazer and Ver em Transações.
 */

const CONVERSATION = "conv-1";

function sse(events: AgentEvent[]): Response {
  const text = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const bytes = new TextEncoder().encode(text);
  // Cut in uneven chunks, as the network does.
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += 37) controller.enqueue(bytes.slice(i, i + 37));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const created = (id: string, role: "user" | "assistant"): AgentEvent => ({
  type: "message_created",
  message: { id, role, kind: role === "user" ? "user_text" : "assistant", createdAt: "2026-10-06T12:00:00.000Z" },
});

const PROPOSE: AgentEvent[] = [
  { type: "turn_started", turnId: "t1" },
  created("u1", "user"),
  created("a1", "assistant"),
  { type: "tool_call_started", messageId: "a1", toolCallId: "tc1", tool: "propose_import_plan", label: "Montando o plano" },
  { type: "tool_call_result", messageId: "a1", toolCallId: "tc1", tool: "propose_import_plan", status: "success" },
  {
    type: "plan_proposed",
    messageId: "a1",
    planId: "plan-1",
    kind: "import",
    summary: { newTransactionCount: 3, totalIncome: 100, totalExpense: 250.5, currency: "BRL" },
    payloadHash: "sha-abc",
    warnings: [],
  },
  { type: "message_complete", messageId: "a1" },
  { type: "turn_completed", turnId: "t1", status: "completed", inputTokens: 1, outputTokens: 1, costUsd: 0 },
];

const COMMIT_RESULT: ExecuteImportResult & { planId: string } = {
  imported: 3,
  duplicatesSkipped: 1,
  reconciled: 0,
  transfersCreated: 0,
  statementImportId: "imp-9",
  batchId: "batch-7",
  planId: "plan-1",
} as ExecuteImportResult & { planId: string };

const COMMIT: AgentEvent[] = [
  { type: "turn_started", turnId: "t2" },
  created("u2", "user"),
  created("a2", "assistant"),
  { type: "tool_call_started", messageId: "a2", toolCallId: "tc2", tool: "commit_plan", label: "Aplicando" },
  { type: "tool_call_result", messageId: "a2", toolCallId: "tc2", tool: "commit_plan", status: "success" },
  { type: "plan_committed", messageId: "a2", planId: "plan-1", kind: "import", result: COMMIT_RESULT },
  { type: "token", messageId: "a2", delta: "Pronto: **3** lançamentos importados." },
  { type: "message_complete", messageId: "a2" },
  { type: "turn_completed", turnId: "t2", status: "completed", inputTokens: 1, outputTokens: 1, costUsd: 0 },
];

/** Streams one turn into the reducer, as use-assistant's run() does. */
async function turn(state: AssistantState, text: string, optimisticId: string): Promise<AssistantState> {
  let next = assistantReducer(state, { type: "send", input: { text }, optimisticId, createdAt: "2026-10-06T12:00:00.000Z" });
  await streamMessage(CONVERSATION, messageBody({ text }, optimisticId), (event) => {
    next = assistantReducer(next, { type: "event", event } satisfies AssistantAction);
  });
  return assistantReducer(next, { type: "ended" });
}

afterEach(() => vi.unstubAllGlobals());

describe("assistant: confirming a plan", () => {
  it("proposes, confirms with the rendered hash, then shows the committed result", async () => {
    const calls: { url: string; method: string; body: unknown }[] = [];
    const answers = [sse(PROPOSE), json({ planId: "plan-1", status: "confirmed" }), sse(COMMIT)];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : null });
        const answer = answers.shift();
        if (!answer) throw new Error(`unexpected request ${url}`);
        return answer;
      }),
    );

    let state = await turn({ ...initialAssistantState, conversationId: CONVERSATION }, "importe o extrato", "local-1");
    const plan = state.messages.flatMap((m) => m.blocks).find((b) => b.kind === "plan");
    expect(plan).toMatchObject({ kind: "plan", planId: "plan-1", payloadHash: "sha-abc", status: "proposed" });
    expect(state.phase).toBe("idle");

    // Confirmar on the card: the exact hash the card rendered.
    await confirmPlan(CONVERSATION, "plan-1", "sha-abc");
    state = assistantReducer(state, { type: "plan_status", planId: "plan-1", status: "confirmed" });
    expect(calls[1]).toEqual({ url: "/api/v1/assistant/conversations/conv-1/plans/plan-1/confirm", method: "POST", body: { payloadHash: "sha-abc" } });

    // The follow-up turn applies it (commit_plan).
    state = await turn(state, "Plano confirmado, pode aplicar.", "local-2");
    expect(calls[2]).toMatchObject({ url: "/api/v1/assistant/conversations/conv-1/messages", method: "POST", body: { text: "Plano confirmado, pode aplicar.", clientMessageId: "local-2" } });

    const blocks = state.messages.flatMap((m) => m.blocks);
    expect(blocks.find((b) => b.kind === "plan")).toMatchObject({ status: "committed" });
    const result = blocks.find((b) => b.kind === "plan_result");
    expect(result).toMatchObject({ kind: "plan_result", planId: "plan-1", planKind: "import" });
    const view = planResultView(result && result.kind === "plan_result" ? result.result : {});
    expect(view).toEqual({
      kind: "import",
      counts: [
        { key: "imported", count: 3 },
        { key: "duplicatesSkipped", count: 1 },
      ],
      batchId: "batch-7",
      importId: "imp-9",
    });
    expect(importRowsHref("imp-9")).toMatch(/^\/transactions\?draft=/);
    expect(blocks.some((b) => b.kind === "text" && b.text.includes("3"))).toBe(true);
    expect(answers).toHaveLength(0);
  });

  it("a stale hash is refused by the server and the card stays open", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ message: "payloadHash does not match", code: "assistant.plan_changed" }, 400)),
    );
    await expect(confirmPlan(CONVERSATION, "plan-1", "old")).rejects.toMatchObject({ status: 400, code: "assistant.plan_changed" });
  });

  it("Rejeitar posts to the reject route", async () => {
    const fetchMock = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>(async () => json({ planId: "plan-1", status: "rejected" }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(rejectPlan(CONVERSATION, "plan-1")).resolves.toEqual({ planId: "plan-1", status: "rejected" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/assistant/conversations/conv-1/plans/plan-1/reject");
  });
});
