import { describe, expect, it } from "vitest";
import { cardResponseLabels, LAST_CONVERSATION_KEY, messagesFromConversation, readLastConversation, resumeError, writeLastConversation } from "../history";
import type { RawAgentMessage } from "../parse-history";

const row = (id: string, role: string, kind: string, content: unknown): RawAgentMessage => ({ id, turnId: "t", role, kind, content, createdAt: `2026-10-05T12:00:0${id.length}.000Z` });

const pair = {
  pairId: "p1",
  incoming: { description: "IFOOD", date: "2026-09-21", amount: 86.9, type: "expense" },
  existing: { id: "e1", description: "iFood", date: "2026-09-21", amount: 86.9, type: "expense" },
  confidence: "high",
  reason: "mesmo valor e data",
};

const ROWS: RawAgentMessage[] = [
  row("u1", "user", "user_text", [{ type: "text", text: "importe" }]),
  row("a1", "assistant", "assistant", [
    { type: "text", text: "Montei o plano." },
    { type: "tool_use", id: "tu1", name: "propose_import_plan", input: {} },
    { type: "tool_use", id: "tu2", name: "present_card", input: {} },
    { type: "tool_use", id: "tu3", name: "propose_import_plan", input: {} },
  ]),
  row("r1", "user", "tool_results", [
    { type: "tool_result", tool_use_id: "tu1", content: JSON.stringify({ planId: "p1", status: "proposed", summary: { newTransactionCount: 3 }, payloadHash: "h", warnings: [] }) },
    { type: "tool_result", tool_use_id: "tu2", content: JSON.stringify({ cardId: "c1", cardType: "duplicate_review", pairs: [pair], status: "pending" }) },
    { type: "tool_result", tool_use_id: "tu3", content: "boom", is_error: true },
  ]),
  row("u2", "user", "card_response", [{ type: "text", text: "[Resposta do usuário ao card duplicate_review, cardId=c1]\n- p1: Manter os dois" }]),
  row("a2", "assistant", "assistant", []),
];

describe("messagesFromConversation", () => {
  it("rebuilds the thread with plans and cards in their saved state", () => {
    const messages = messagesFromConversation({ messages: ROWS, plans: [{ id: "p1", status: "committed" }] });
    expect(messages.map((m) => m.id)).toEqual(["u1", "a1", "u2"]);
    const blocks = messages[1].blocks;
    expect(blocks.map((b) => b.kind)).toEqual(["text", "plan", "card"]);
    expect(blocks[1]).toMatchObject({ kind: "plan", planId: "p1", status: "committed", summary: { newTransactionCount: 3 } });
    expect(blocks[2]).toMatchObject({ kind: "card", card: { cardId: "c1", status: "answered" } });
    expect(messages[2].blocks).toEqual([{ kind: "card_response", text: "Manter os dois" }]);
  });

  it("keeps a card pending when nobody answered it", () => {
    const messages = messagesFromConversation({ messages: ROWS.slice(0, 3), plans: [] });
    expect(messages[1].blocks[2]).toMatchObject({ kind: "card", card: { status: "pending" } });
    expect(messages[1].blocks[1]).toMatchObject({ kind: "plan", status: "proposed" });
  });
});

describe("cardResponseLabels", () => {
  it("lists the labels of a saved answer", () => {
    expect(cardResponseLabels("[Resposta …, cardId=c]\n- a: Mesclar\n- b: Pular")).toBe("Mesclar, Pular");
  });
  it("keeps other text as it is", () => {
    expect(cardResponseLabels("sim")).toBe("sim");
  });
});

describe("resumeError", () => {
  const messages = messagesFromConversation({ messages: ROWS.slice(0, 1), plans: [] });
  it("brings back the error of a failed last turn, to re-run it", () => {
    const result = resumeError(
      {
        turns: [
          { id: "t0", status: "completed", createdAt: "2026-10-05T11:00:00Z", error: null },
          { id: "t1", status: "failed", createdAt: "2026-10-05T12:00:00Z", error: "sem chave" },
        ],
      },
      messages,
    );
    expect(result).toEqual({ kind: "turn", code: "TURN_FAILED", message: "sem chave", retryable: true });
  });
  it("brings back the limit notice of a turn stopped at its budget, with no retry", () => {
    const result = resumeError({ turns: [{ id: "t", status: "completed", createdAt: "x", error: "Orçamento do turno atingido" }] }, messages);
    expect(result).toEqual({ kind: "turn", code: "TURN_LIMIT", message: "Orçamento do turno atingido", retryable: false });
  });
  it("is empty after a good turn", () => {
    expect(resumeError({ turns: [{ id: "t", status: "completed", createdAt: "x", error: null }] }, messages)).toBeNull();
  });
});

describe("last conversation", () => {
  function memory() {
    const data = new Map<string, string>();
    return {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key),
      data,
    };
  }

  it("remembers, forgets and validates the id", () => {
    const storage = memory();
    writeLastConversation(storage, "cm1abc");
    expect(readLastConversation(storage)).toBe("cm1abc");
    writeLastConversation(storage, null);
    expect(readLastConversation(storage)).toBeNull();
    storage.data.set(LAST_CONVERSATION_KEY, "../x?y");
    expect(readLastConversation(storage)).toBeNull();
  });

  it("survives storage that throws or is missing", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readLastConversation(broken)).toBeNull();
    expect(() => writeLastConversation(broken, "x")).not.toThrow();
    expect(readLastConversation(null)).toBeNull();
  });
});
