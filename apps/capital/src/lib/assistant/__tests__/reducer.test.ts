import { describe, expect, it } from "vitest";
import { assistantReducer, canRetry, initialAssistantState, isBusy, type AssistantAction, type AssistantState } from "../reducer";
import { createSseParser, parseAgentEvent, type AgentEvent } from "../sse";

function run(actions: AssistantAction[], state: AssistantState = initialAssistantState): AssistantState {
  return actions.reduce(assistantReducer, state);
}

const send = (text: string): AssistantAction => ({ type: "send", input: { text }, optimisticId: "pending-1", createdAt: "2026-10-05T12:00:00.000Z" });
const ev = (event: AgentEvent): AssistantAction => ({ type: "event", event });
const created = (id: string, role: "user" | "assistant", kind = role === "user" ? "user_text" : "assistant"): AgentEvent => ({
  type: "message_created",
  message: { id, role, kind, createdAt: "2026-10-05T12:00:01.000Z" },
});

/** A turn as the server writes it (routes/v1/post-message.ts), replayed through the SSE parser in uneven chunks. */
function recorded(events: AgentEvent[], chunkSize = 23): AgentEvent[] {
  const text = events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join("");
  const parser = createSseParser();
  const out: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    for (const frame of parser.push(text.slice(i, i + chunkSize))) {
      const event = parseAgentEvent(frame);
      if (event) out.push(event);
    }
  }
  return out;
}

describe("assistantReducer: a recorded turn", () => {
  it("token, message_complete, plan_proposed, error, turn_completed", () => {
    const events = recorded([
      { type: "turn_started", turnId: "t1" },
      created("u1", "user"),
      created("a1", "assistant"),
      { type: "token", messageId: "a1", delta: "Encontrei **12** lançamentos" },
      { type: "token", messageId: "a1", delta: " novos." },
      { type: "message_complete", messageId: "a1" },
      created("r1", "user", "tool_results"),
      created("a2", "assistant"),
      { type: "tool_call_started", messageId: "a2", toolCallId: "tc1", tool: "propose_import_plan", label: "Montando o plano de importação" },
      { type: "tool_call_result", messageId: "a2", toolCallId: "tc1", tool: "propose_import_plan", status: "success" },
      {
        type: "plan_proposed",
        messageId: "a2",
        planId: "p1",
        kind: "import",
        summary: { newTransactionCount: 12, totalIncome: 0, totalExpense: 1234.56, currency: "BRL" },
        payloadHash: "h1",
        warnings: ["2 linhas sem data"],
      },
      { type: "message_complete", messageId: "a2" },
      { type: "error", code: "TURN_FAILED", message: "Orçamento do turno atingido", retryable: true },
      { type: "turn_completed", turnId: "t1", status: "failed", inputTokens: 10, outputTokens: 20, costUsd: 0.01 },
    ]);
    const state = run([send("importe o extrato"), ...events.map(ev), { type: "ended" }]);

    expect(state.phase).toBe("idle");
    expect(state.lastTurn).toBe("failed");
    expect(state.messages.map((m) => [m.id, m.role, m.status])).toEqual([
      ["u1", "user", "complete"],
      ["a1", "assistant", "complete"],
      ["a2", "assistant", "complete"],
    ]);
    expect(state.messages[0].blocks).toEqual([{ kind: "text", text: "importe o extrato" }]);
    expect(state.messages[1].blocks).toEqual([{ kind: "text", text: "Encontrei **12** lançamentos novos." }]);
    expect(state.messages[2].blocks).toEqual([
      { kind: "tool", toolCallId: "tc1", tool: "propose_import_plan", label: "Montando o plano de importação", status: "success", summary: undefined },
      {
        kind: "plan",
        planId: "p1",
        planKind: "import",
        summary: { newTransactionCount: 12, totalIncome: 0, totalExpense: 1234.56, currency: "BRL" },
        payloadHash: "h1",
        warnings: ["2 linhas sem data"],
        status: "proposed",
      },
    ]);
    expect(state.error).toEqual({ kind: "turn", code: "TURN_FAILED", message: "Orçamento do turno atingido", retryable: true });
    expect(canRetry(state)).toBe(true);
    expect(state.lastInput).toEqual({ text: "importe o extrato" });
  });
});

describe("assistantReducer", () => {
  it("shows the sent message at once and is busy until the turn completes", () => {
    let state = run([send("oi")]);
    expect(state.phase).toBe("sending");
    expect(isBusy(state)).toBe(true);
    expect(state.messages).toEqual([{ id: "pending-1", role: "user", status: "sending", createdAt: "2026-10-05T12:00:00.000Z", blocks: [{ kind: "text", text: "oi" }] }]);
    state = run([ev({ type: "turn_started", turnId: "t" }), ev(created("u1", "user"))], state);
    expect(state.phase).toBe("streaming");
    expect(state.messages[0]).toMatchObject({ id: "u1", status: "complete" });
    state = run([ev({ type: "turn_completed", turnId: "t", status: "completed", inputTokens: 0, outputTokens: 0, costUsd: 0 })], state);
    expect(isBusy(state)).toBe(false);
    expect(state.error).toBeNull();
  });

  it("keeps text, tool and text in order within one message", () => {
    const state = run([
      send("q"),
      ev(created("a1", "assistant")),
      ev({ type: "token", messageId: "a1", delta: "Vou buscar." }),
      ev({ type: "tool_call_started", messageId: "a1", toolCallId: "t1", tool: "search_transactions", label: "Buscando transações" }),
      ev({ type: "tool_call_result", messageId: "a1", toolCallId: "t1", tool: "search_transactions", status: "success", summary: "3 encontradas" }),
      ev({ type: "token", messageId: "a1", delta: "Achei 3." }),
    ]);
    expect(state.messages[1].blocks.map((block) => block.kind)).toEqual(["text", "tool", "text"]);
    expect(state.messages[1].blocks[1]).toMatchObject({ status: "success", summary: "3 encontradas" });
  });

  it("a new plan supersedes the one still proposed; committing marks it and adds the result", () => {
    const plan = (planId: string): AgentEvent => ({ type: "plan_proposed", messageId: "a1", planId, kind: "import", summary: {}, payloadHash: `h-${planId}`, warnings: [] });
    let state = run([send("q"), ev(created("a1", "assistant")), ev(plan("p1")), ev(plan("p2"))]);
    const statuses = () => state.messages.flatMap((m) => m.blocks).filter((b) => b.kind === "plan").map((b) => (b.kind === "plan" ? [b.planId, b.status] : null));
    expect(statuses()).toEqual([
      ["p1", "superseded"],
      ["p2", "proposed"],
    ]);
    state = run([{ type: "plan_status", planId: "p2", status: "confirmed" }], state);
    expect(statuses()).toEqual([
      ["p1", "superseded"],
      ["p2", "confirmed"],
    ]);
    state = run([ev(created("a2", "assistant")), ev({ type: "plan_committed", messageId: "a2", planId: "p2", kind: "import", result: { imported: 12, batchId: "b1" } })], state);
    expect(statuses()).toEqual([
      ["p1", "superseded"],
      ["p2", "committed"],
    ]);
    expect(state.messages.at(-1)?.blocks).toEqual([{ kind: "plan_result", planId: "p2", planKind: "import", result: { imported: 12, batchId: "b1" } }]);
  });

  it("a committed revert is shown as a revert", () => {
    const state = run([send("q"), ev(created("a1", "assistant")), ev({ type: "plan_committed", messageId: "a1", planId: "p", kind: "import", result: { transactionsDeleted: 4 } })]);
    expect(state.messages[1].blocks[0]).toMatchObject({ kind: "plan_result", planKind: "revert" });
  });

  it("adds duplicate cards, and locks them when answered", () => {
    const card = { cardId: "c1", cardType: "duplicate_review", pairs: [{ pairId: "x" }], status: "pending" };
    let state = run([send("q"), ev(created("a1", "assistant")), ev({ type: "action_card", messageId: "a1", card }), ev({ type: "action_card", messageId: "a1", card: { nope: true } })]);
    expect(state.messages[1].blocks).toHaveLength(1);
    state = run([{ type: "card_answered", cardId: "c1", decisions: { x: "skip" } }], state);
    expect(state.messages[1].blocks[0]).toMatchObject({ kind: "card", card: { status: "answered", decisions: { x: "skip" } } });
  });

  it("a request that fails drops the pending bubble and offers to retry", () => {
    const state = run([send("oi"), { type: "failed", error: { kind: "request", status: 409, code: "assistant.turn_running", params: {} } }]);
    expect(state.messages).toEqual([]);
    expect(state.phase).toBe("idle");
    expect(canRetry(state)).toBe(true);
    expect(run([send("de novo")], state).error).toBeNull();
  });

  it("a non-retryable turn error has no retry", () => {
    const state = run([send("oi"), ev({ type: "error", code: "X", message: "m", retryable: false }), { type: "ended" }]);
    expect(canRetry(state)).toBe(false);
  });

  it("stopping ends the turn and removes an assistant message that got nothing", () => {
    const state = run([send("oi"), ev(created("u1", "user")), ev(created("a1", "assistant")), { type: "cancelled" }]);
    expect(state.phase).toBe("idle");
    expect(state.lastTurn).toBe("cancelled");
    expect(state.messages.map((m) => m.id)).toEqual(["u1"]);
  });

  it("a failed turn without an error event still shows an error", () => {
    const state = run([send("oi"), ev({ type: "turn_completed", turnId: "t", status: "failed", inputTokens: 0, outputTokens: 0, costUsd: 0 })]);
    expect(state.error).toMatchObject({ kind: "turn", code: "TURN_FAILED", retryable: true });
  });

  it("ignores events for unknown messages and the tool_results rows", () => {
    const state = run([send("oi"), ev(created("r", "user", "tool_results")), ev({ type: "token", messageId: "nope", delta: "x" })]);
    expect(state.messages).toHaveLength(1);
    expect(state.messages[0].status).toBe("sending");
  });

  it("reset and loaded start over", () => {
    const loaded = run([send("oi"), { type: "loaded", conversationId: "c", title: "T", messages: [] }]);
    expect(loaded).toMatchObject({ conversationId: "c", title: "T", messages: [], phase: "idle" });
    expect(run([{ type: "reset" }], loaded)).toEqual(initialAssistantState);
  });

  it("keeps the first title it gets", () => {
    const state = run([
      { type: "conversation", conversationId: "c", title: "Primeiro" },
      { type: "conversation", conversationId: "c", title: "Outro" },
    ]);
    expect(state.title).toBe("Primeiro");
  });
});
