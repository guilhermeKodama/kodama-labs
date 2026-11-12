import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { prisma } from "@capital/server/lib/prisma";
import { estimateCostUsd } from "@capital/server/lib/anthropic";
import { runAgentTurn, type RunAgentTurnInput } from "../loop";
import { executeTool, type ToolExecutionResult } from "../tools/registry";
import { getObjectBuffer } from "@/lib/storage";
import type { AgentEvent } from "../events";

/**
 * runAgentTurn against the real database with a scripted model. What is
 * checked is what a user would feel: the events the browser receives, the
 * rows a refresh would load back, the history the next model call is
 * given, and the totals the turn is billed for. The model is a script of
 * replies, the blob store a mock, and tool results are scripted where the
 * loop's reaction to a particular output is the point (the tools
 * themselves are tested next to them).
 */

interface ScriptedReply {
  content?: unknown[];
  usage?: Partial<Anthropic.Usage>;
  /** Text deltas the stream announces before the final message. */
  deltas?: string[];
  /** Runs while the model is "thinking", before the final message. */
  during?: () => Promise<void>;
  /** Rejects the stream with this (an Error, or any other value). */
  reject?: unknown;
}

interface StreamParams {
  model: string;
  max_tokens: number;
  thinking: unknown;
  system: Array<{ type: string; text: string; cache_control?: unknown }>;
  messages: Array<{ role: string; content: unknown }>;
  tools: Array<{ name: string; type?: string; max_uses?: number }>;
}

const model = vi.hoisted(() => ({
  configured: true,
  replies: [] as unknown[],
  requests: [] as unknown[],
  titleRequests: [] as unknown[],
}));

vi.mock("@capital/server/lib/anthropic", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@capital/server/lib/anthropic")>();
  const client = {
    messages: {
      stream(params: { messages: unknown[] }) {
        model.requests.push(JSON.parse(JSON.stringify(params)));
        const reply = (model.replies.shift() ?? { content: [{ type: "text", text: "ok" }] }) as ScriptedReply;
        let onText: ((delta: string) => void) | undefined;
        return {
          on: (event: string, listener: (delta: string) => void) => {
            if (event === "text") onText = listener;
          },
          finalMessage: async () => {
            for (const delta of reply.deltas ?? []) onText?.(delta);
            await reply.during?.();
            if ("reject" in reply) throw reply.reject;
            return {
              content: reply.content ?? [],
              usage: { input_tokens: 10, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, ...reply.usage },
            };
          },
        };
      },
      create: async (params: unknown) => {
        model.titleRequests.push(params);
        return { content: [{ type: "text", text: "Título da conversa" }] };
      },
    },
  };
  return { ...actual, getAnthropicClient: () => (model.configured ? client : null) };
});

vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, getObjectBuffer: vi.fn() };
});

vi.mock("../tools/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../tools/registry")>();
  return { ...actual, executeTool: vi.fn(actual.executeTool) };
});

const USER = "test-user-assistant-loop-001";
const OTHER = "test-user-assistant-loop-002";

let conversationId: string;

const toolUse = (id: string, name: string, input: unknown = {}) => ({ type: "tool_use", id, name, input });
const reply = (...content: unknown[]): ScriptedReply => ({ content });
const text = (value: string) => ({ type: "text", text: value });

function toolResult(name: string, output: unknown, extra: Partial<ToolExecutionResult> = {}): ToolExecutionResult {
  return { toolUseId: "tu", toolName: name, output, isError: false, durationMs: 1, ...extra };
}

async function turn(input: Partial<RunAgentTurnInput> = {}, id = conversationId) {
  const events: AgentEvent[] = [];
  await runAgentTurn({ userId: USER, conversationId: id, text: "oi", ...input }, (event) => events.push(event));
  return events;
}

const ofType = <T extends AgentEvent["type"]>(events: AgentEvent[], type: T) =>
  events.filter((event): event is Extract<AgentEvent, { type: T }> => event.type === type);
const requests = () => model.requests as StreamParams[];
const lastRequest = () => requests().at(-1)!;
const savedTurn = (id = conversationId) => prisma.agentTurn.findFirstOrThrow({ where: { conversationId: id }, orderBy: { createdAt: "desc" } });
const savedMessages = (id = conversationId) => prisma.agentMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });

async function conversationWithFiles(files: Array<{ name: string; fileType: "pdf" | "image" | "ofx" | "csv"; mimeType: string; userId?: string; conversation?: string }>) {
  const ids: string[] = [];
  for (const file of files) {
    const row = await prisma.conversationFile.create({
      data: {
        conversationId: file.conversation ?? conversationId,
        userId: file.userId ?? USER,
        fileType: file.fileType,
        statementKind: file.fileType === "ofx" ? "bank_ofx" : file.fileType,
        blobUrl: `https://blob.test/${file.name}`,
        pathname: file.name,
        mimeType: file.mimeType,
        sizeBytes: 100,
        originalName: file.name,
        parseStatus: "not_applicable",
      },
      select: { id: true },
    });
    ids.push(row.id);
  }
  return ids;
}

async function createUser(id: string) {
  await prisma.user.deleteMany({ where: { id } });
  await prisma.user.create({ data: { id, email: `${id}@example.com`, passwordHash: "x", name: id } });
}

beforeAll(async () => {
  await createUser(USER);
  await createUser(OTHER);
});

beforeEach(async () => {
  model.configured = true;
  model.replies = [];
  model.requests = [];
  model.titleRequests = [];
  vi.mocked(getObjectBuffer).mockReset();
  vi.mocked(executeTool).mockClear();
  await prisma.agentConversation.deleteMany({ where: { userId: { in: [USER, OTHER] } } });
  conversationId = (await prisma.agentConversation.create({ data: { userId: USER, title: "Teste" }, select: { id: true } })).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [USER, OTHER] } } });
});

describe("a plain turn", () => {
  it("announces the turn, streams the tokens and saves the user message and the answer", async () => {
    model.replies = [{ content: [text("Olá, tudo bem?")], deltas: ["Olá, ", "tudo bem?"] }];

    const events = await turn({ text: "oi" });

    const rows = await savedMessages();
    const [userRow, assistantRow] = rows;
    const savedTurnRow = await savedTurn();
    expect(events.map((event) => event.type)).toEqual([
      "turn_started",
      "message_created",
      "message_created",
      "token",
      "token",
      "message_complete",
      "turn_completed",
    ]);
    expect(events[0]).toEqual({ type: "turn_started", turnId: savedTurnRow.id });
    expect(ofType(events, "message_created").map((event) => event.message)).toEqual([
      { id: userRow!.id, role: "user", kind: "user_text", createdAt: userRow!.createdAt.toISOString() },
      { id: assistantRow!.id, role: "assistant", kind: "assistant", createdAt: assistantRow!.createdAt.toISOString() },
    ]);
    expect(ofType(events, "token")).toEqual([
      { type: "token", messageId: assistantRow!.id, delta: "Olá, " },
      { type: "token", messageId: assistantRow!.id, delta: "tudo bem?" },
    ]);
    expect(ofType(events, "message_complete")).toEqual([{ type: "message_complete", messageId: assistantRow!.id }]);

    expect(rows.map((row) => [row.role, row.kind, row.turnId, row.content])).toEqual([
      ["user", "user_text", savedTurnRow.id, [{ type: "text", text: "oi" }]],
      ["assistant", "assistant", savedTurnRow.id, [{ type: "text", text: "Olá, tudo bem?" }]],
    ]);
    expect(savedTurnRow).toMatchObject({ status: "completed", iterations: 1, error: null, model: env.CAPITAL_AGENT_MODEL });
    expect(savedTurnRow.completedAt).toBeInstanceOf(Date);
  });

  it("sends the model the knowledge, today's date and conversation, the tools and the web search", async () => {
    await turn({ text: "oi" });

    const request = lastRequest();
    expect(request.model).toBe(env.CAPITAL_AGENT_MODEL);
    expect(request.max_tokens).toBe(8192);
    expect(request.thinking).toEqual({ type: "adaptive" });
    expect(request.system).toHaveLength(2);
    expect(request.system[0]).toMatchObject({ type: "text", cache_control: { type: "ephemeral" } });
    expect(request.system[0]!.text.length).toBeGreaterThan(1000);
    expect(request.system[1]!.text).toBe(`Data de hoje: ${new Date().toISOString().split("T")[0]}. conversationId: ${conversationId}.`);
    expect(request.messages).toEqual([{ role: "user", content: [{ type: "text", text: "oi" }] }]);
    const names = request.tools.map((tool) => tool.name);
    expect(names).toEqual(expect.arrayContaining(["get_context_snapshot", "propose_import_plan", "commit_plan", "present_card"]));
    expect(request.tools.at(-1)).toMatchObject({ type: "web_search_20250305", name: "web_search", max_uses: 5 });
  });

  it("totals the usage of every round and bills the turn for it", async () => {
    const usage = { input_tokens: 1000, output_tokens: 500, cache_creation_input_tokens: 200, cache_read_input_tokens: 300 };
    model.replies = [{ content: [toolUse("tu1", "not_a_real_tool")], usage }, { content: [text("Feito.")], usage }];

    const events = await turn();

    const cost = 2 * estimateCostUsd(env.CAPITAL_AGENT_MODEL, usage as Anthropic.Usage);
    const saved = await savedTurn();
    expect(saved).toMatchObject({ iterations: 2, inputTokens: 2000, outputTokens: 1000, cacheCreationInputTokens: 400, cacheReadInputTokens: 600 });
    expect(Number(saved.costUsd)).toBeCloseTo(cost, 6);
    expect(saved.durationMs).toBeGreaterThanOrEqual(0);
    expect(ofType(events, "turn_completed")).toEqual([
      { type: "turn_completed", turnId: saved.id, status: "completed", inputTokens: 2000, outputTokens: 1000, costUsd: expect.closeTo(cost, 9) },
    ]);
  });

  it("treats cache token counts the API leaves null as zero", async () => {
    model.replies = [
      {
        content: [text("ok")],
        usage: { input_tokens: 40, output_tokens: 20, cache_creation_input_tokens: null, cache_read_input_tokens: null } as unknown as Partial<Anthropic.Usage>,
      },
    ];

    const events = await turn();

    const saved = await savedTurn();
    expect(saved).toMatchObject({ inputTokens: 40, outputTokens: 20, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 });
    expect(Number(saved.costUsd)).toBeCloseTo(estimateCostUsd(env.CAPITAL_AGENT_MODEL, { input_tokens: 40, output_tokens: 20 } as Anthropic.Usage), 6);
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", status: "completed" });
  });

  it("counts a web search toward the cost, apart from the tokens", async () => {
    model.replies = [{ content: [text("achei")], usage: { server_tool_use: { web_search_requests: 2 } } as Partial<Anthropic.Usage> }];

    await turn();

    const withoutSearch = estimateCostUsd(env.CAPITAL_AGENT_MODEL, { input_tokens: 10, output_tokens: 10 } as Anthropic.Usage);
    expect(Number((await savedTurn()).costUsd)).toBeCloseTo(withoutSearch + 0.02, 6);
  });
});

describe("what the user sends", () => {
  it("gives a conversation with no title one, from the first message", async () => {
    await prisma.agentConversation.update({ where: { id: conversationId }, data: { title: null } });

    await turn({ text: "importar o extrato" });

    expect(model.titleRequests).toHaveLength(1);
    expect(JSON.stringify(model.titleRequests[0])).toContain("importar o extrato");
    expect((await prisma.agentConversation.findUniqueOrThrow({ where: { id: conversationId } })).title).toBe("Título da conversa");
  });

  it("names a conversation from the file names when the message is only a file", async () => {
    await prisma.agentConversation.update({ where: { id: conversationId }, data: { title: null } });
    const [fileId] = await conversationWithFiles([{ name: "extrato-marco.ofx", fileType: "ofx", mimeType: "text/plain" }]);

    await turn({ text: undefined, fileIds: [fileId!] });

    expect(JSON.stringify(model.titleRequests[0])).toContain("extrato-marco.ofx");
  });

  it("bumps the conversation to the top of the list", async () => {
    await prisma.agentConversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date("2020-01-01T00:00:00Z") } });
    await turn();
    expect((await prisma.agentConversation.findUniqueOrThrow({ where: { id: conversationId } })).lastMessageAt.getFullYear()).toBeGreaterThanOrEqual(new Date().getFullYear());
  });

  it("saves a card answer as a card_response, locks the card and does not name the conversation", async () => {
    await prisma.agentConversation.update({ where: { id: conversationId }, data: { title: null } });
    const cardResponse = { cardId: "card-7", decisions: [{ pairId: "p1", label: "Duplicado" }, { pairId: "p2", label: "Novo" }] };

    const events = await turn({ text: undefined, cardResponse });

    expect(ofType(events, "card_locked")).toEqual([{ type: "card_locked", cardId: "card-7", decision: cardResponse.decisions }]);
    const [user] = await savedMessages();
    expect(user).toMatchObject({ role: "user", kind: "card_response" });
    expect(user!.content).toEqual([
      { type: "text", text: "[Resposta do usuário ao card duplicate_review, cardId=card-7]\n- p1: Duplicado\n- p2: Novo" },
      { type: "capital_card_response", cardId: "card-7", decisions: cardResponse.decisions },
    ]);
    expect(ofType(events, "message_created")[0]!.message.kind).toBe("card_response");
    // The marker only exists for the UI: the model sees the text.
    expect(requests()[0]!.messages[0]).toEqual({
      role: "user",
      content: [{ type: "text", text: "[Resposta do usuário ao card duplicate_review, cardId=card-7]\n- p1: Duplicado\n- p2: Novo" }],
    });
    expect(model.titleRequests).toEqual([]);
  });

  it("keeps the text next to a card answer", async () => {
    await turn({ text: "esse eu mantenho", cardResponse: { cardId: "c", decisions: [] } });
    const [user] = await savedMessages();
    expect((user!.content as Array<{ type: string }>).map((block) => block.type)).toEqual(["text", "text", "capital_card_response"]);
  });

  it("attaches a PDF and an image as file refs the model gets as real blocks", async () => {
    const [pdf, image] = await conversationWithFiles([
      { name: "nota.pdf", fileType: "pdf", mimeType: "application/pdf" },
      { name: "recibo.png", fileType: "image", mimeType: "image/png" },
    ]);
    vi.mocked(getObjectBuffer).mockResolvedValue(Buffer.from("bytes"));

    await turn({ text: "veja isso", fileIds: [pdf!, image!] });

    const [user] = await savedMessages();
    expect(user!.content).toEqual([
      { type: "text", text: "veja isso" },
      { type: "capital_file_ref", fileId: pdf, originalName: "nota.pdf", blobUrl: "https://blob.test/nota.pdf", mediaType: "application/pdf" },
      { type: "capital_file_ref", fileId: image, originalName: "recibo.png", blobUrl: "https://blob.test/recibo.png", mediaType: "image/png" },
    ]);
    const sent = requests()[0]!.messages[0]!.content as Array<{ type: string }>;
    expect(sent.map((block) => block.type)).toEqual(["text", "document", "image"]);
    // No bytes in the database row.
    expect(JSON.stringify(user!.content)).not.toContain(Buffer.from("bytes").toString("base64"));
  });

  it("tells the model about an attached OFX with a note, since it never goes in as a block", async () => {
    const [one] = await conversationWithFiles([{ name: "extrato.ofx", fileType: "ofx", mimeType: "text/plain" }]);

    await turn({ text: undefined, fileIds: [one!] });

    const [user] = await savedMessages();
    expect(user!.content).toEqual([{ type: "text", text: "[Anexei o arquivo extrato.ofx à conversa - veja list_statement_files.]" }]);
  });

  it("names every file in the note when several non-PDF files are attached", async () => {
    const ids = await conversationWithFiles([
      { name: "a.ofx", fileType: "ofx", mimeType: "text/plain" },
      { name: "b.csv", fileType: "csv", mimeType: "text/csv" },
    ]);

    await turn({ text: undefined, fileIds: ids });

    const [user] = await savedMessages();
    expect(user!.content).toEqual([{ type: "text", text: "[Anexei os arquivos a.ofx, b.csv à conversa - veja list_statement_files.]" }]);
  });

  it("adds no note when there is already text, and never attaches a file of another conversation or user", async () => {
    const otherConversation = (await prisma.agentConversation.create({ data: { userId: USER, title: "Outra" }, select: { id: true } })).id;
    const strangerConversation = (await prisma.agentConversation.create({ data: { userId: OTHER, title: "Alheia" }, select: { id: true } })).id;
    const [own] = await conversationWithFiles([{ name: "meu.ofx", fileType: "ofx", mimeType: "text/plain" }]);
    const [elsewhere] = await conversationWithFiles([{ name: "outra.ofx", fileType: "ofx", mimeType: "text/plain", conversation: otherConversation }]);
    const [stranger] = await conversationWithFiles([{ name: "alheio.ofx", fileType: "ofx", mimeType: "text/plain", userId: OTHER, conversation: strangerConversation }]);

    await turn({ text: "segue o extrato", fileIds: [own!, elsewhere!, stranger!] });

    const [user] = await savedMessages();
    expect(user!.content).toEqual([{ type: "text", text: "segue o extrato" }]);

    // And with nothing else to say, the files that are not its own leave the message empty.
    const empty = (await prisma.agentConversation.create({ data: { userId: USER, title: "Vazia" }, select: { id: true } })).id;
    await turn({ text: undefined, fileIds: [elsewhere!, stranger!] }, empty);
    const [emptyUser] = await savedMessages(empty);
    expect(emptyUser!.content).toEqual([{ type: "text", text: "(mensagem vazia)" }]);
  });

  it("saves a placeholder when the message has nothing in it", async () => {
    await turn({ text: undefined });
    const [user] = await savedMessages();
    expect(user!.content).toEqual([{ type: "text", text: "(mensagem vazia)" }]);
  });

  it("does not save the user message again on a retry, and answers the one already saved", async () => {
    await prisma.agentMessage.create({
      data: { conversationId, role: "user", kind: "user_text", content: [{ type: "text", text: "já salva" }] },
    });

    const events = await turn({ text: undefined, retry: true });

    expect(await prisma.agentMessage.count({ where: { conversationId, role: "user" } })).toBe(1);
    expect(ofType(events, "message_created").map((event) => event.message.role)).toEqual(["assistant"]);
    expect(requests()[0]!.messages).toEqual([{ role: "user", content: [{ type: "text", text: "já salva" }] }]);
    expect(model.titleRequests).toEqual([]);
  });
});

describe("a turn that fails", () => {
  it("fails with the message and keeps the user message when the API key is not configured", async () => {
    model.configured = false;

    const events = await turn({ text: "oi" });

    expect(ofType(events, "error")).toEqual([
      { type: "error", code: "TURN_FAILED", message: "ANTHROPIC_API_KEY não configurada neste ambiente.", retryable: true },
    ]);
    expect(ofType(events, "turn_completed")).toEqual([expect.objectContaining({ status: "failed", inputTokens: 0, outputTokens: 0, costUsd: 0 })]);
    expect(requests()).toEqual([]);
    const saved = await savedTurn();
    expect(saved).toMatchObject({ status: "failed", iterations: 0, error: "ANTHROPIC_API_KEY não configurada neste ambiente." });
    expect((await savedMessages()).map((row) => row.kind)).toEqual(["user_text"]);
  });

  it("fails with the model's error and still totals what the earlier rounds used", async () => {
    model.replies = [{ content: [toolUse("tu1", "not_a_real_tool")], usage: { input_tokens: 700 } }, { reject: new Error("overloaded") }];

    const events = await turn();

    expect(ofType(events, "error")).toEqual([{ type: "error", code: "TURN_FAILED", message: "overloaded", retryable: true }]);
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", status: "failed", inputTokens: 700 });
    expect(await savedTurn()).toMatchObject({ status: "failed", iterations: 2, inputTokens: 700, error: "overloaded" });
  });

  it("reports an unknown error when what was thrown is not an Error", async () => {
    model.replies = [{ reject: "boom" }];

    const events = await turn();

    expect(ofType(events, "error")).toEqual([
      { type: "error", code: "TURN_FAILED", message: "Erro desconhecido no turno do agente", retryable: true },
    ]);
    expect((await savedTurn()).error).toBe("Erro desconhecido no turno do agente");
  });
});

describe("cancelling", () => {
  it("stops before the next round when the turn was cancelled meanwhile", async () => {
    model.replies = [
      {
        content: [toolUse("tu1", "not_a_real_tool")],
        during: async () => {
          await prisma.agentTurn.updateMany({ where: { conversationId, status: "running" }, data: { status: "cancelled" } });
        },
      },
      reply(text("não devia chegar aqui")),
    ];

    const events = await turn();

    expect(requests()).toHaveLength(1);
    expect(ofType(events, "error")).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", status: "cancelled" });
    expect(await savedTurn()).toMatchObject({ status: "cancelled", error: null });
    // What the first round did is kept: the answer and the tool results.
    expect((await savedMessages()).map((row) => row.kind)).toEqual(["user_text", "assistant", "tool_results"]);
  });
});

describe("tool calls", () => {
  it("runs the tool, reports it with its label, and gives the model the result on the next round", async () => {
    const [fileId] = await conversationWithFiles([{ name: "extrato.ofx", fileType: "ofx", mimeType: "text/plain" }]);
    model.replies = [
      { content: [text("Vou ver os arquivos."), toolUse("tu-files", "list_statement_files")] },
      { content: [text("Há um arquivo.")] },
    ];

    const events = await turn();

    expect(ofType(events, "tool_call_started")).toEqual([
      expect.objectContaining({ toolCallId: "tu-files", tool: "list_statement_files", label: "Verificando arquivos da conversa" }),
    ]);
    expect(ofType(events, "tool_call_result")).toEqual([
      expect.objectContaining({ toolCallId: "tu-files", tool: "list_statement_files", status: "success", summary: undefined }),
    ]);
    expect(executeTool).toHaveBeenCalledWith(expect.any(Array), expect.objectContaining({ userId: USER, conversationId }), "tu-files", "list_statement_files", {});

    const rows = await savedMessages();
    expect(rows.map((row) => [row.role, row.kind])).toEqual([
      ["user", "user_text"],
      ["assistant", "assistant"],
      ["user", "tool_results"],
      ["assistant", "assistant"],
    ]);
    const stored = (rows[2]!.content as Array<{ type: string; tool_use_id: string; content: string; is_error: boolean }>)[0]!;
    expect(stored).toMatchObject({ type: "tool_result", tool_use_id: "tu-files", is_error: false });
    expect(JSON.parse(stored.content)).toMatchObject({ files: [{ fileId, originalName: "extrato.ofx", fileType: "ofx" }] });

    // The second round saw the assistant's blocks and the tool result, in order.
    const second = requests()[1]!.messages;
    expect(second.map((message) => message.role)).toEqual(["user", "assistant", "user"]);
    expect(second[1]!.content).toEqual([text("Vou ver os arquivos."), toolUse("tu-files", "list_statement_files")]);
    expect(second[2]!.content).toEqual([stored]);
    expect(ofType(events, "message_created").map((event) => event.message.kind)).toEqual(["user_text", "assistant", "tool_results", "assistant"]);
  });

  it("labels a tool it has no label for, and returns the error to the model when the tool is unknown", async () => {
    model.replies = [{ content: [toolUse("tu1", "not_a_real_tool")] }, reply(text("ok"))];

    const events = await turn();

    expect(ofType(events, "tool_call_started")[0]).toMatchObject({ tool: "not_a_real_tool", label: "Executando not_a_real_tool" });
    expect(ofType(events, "tool_call_result")).toEqual([
      expect.objectContaining({ tool: "not_a_real_tool", status: "error", summary: undefined }),
    ]);
    const [, , results] = await savedMessages();
    expect(results!.content).toEqual([
      { type: "tool_result", tool_use_id: "tu1", content: JSON.stringify({ error: 'Unknown tool "not_a_real_tool". It is not in the allowlist.' }), is_error: true },
    ]);
    // The turn itself still completes: the model gets to correct itself.
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", status: "completed" });
  });

  it("answers every tool call of a round in one tool_results message, in order", async () => {
    model.replies = [{ content: [toolUse("a", "not_a_real_tool"), toolUse("b", "list_statement_files")] }, reply(text("ok"))];

    await turn();

    const rows = await savedMessages();
    const results = rows.filter((row) => row.kind === "tool_results");
    expect(results).toHaveLength(1);
    expect((results[0]!.content as Array<{ tool_use_id: string; is_error: boolean }>).map((block) => [block.tool_use_id, block.is_error])).toEqual([
      ["a", true],
      ["b", false],
    ]);
  });

  describe("the one-line summary of a result", () => {
    const run = async (name: string, output: unknown) => {
      model.replies = [{ content: [toolUse("tu", name)] }, reply(text("ok"))];
      vi.mocked(executeTool).mockResolvedValueOnce(toolResult(name, output));
      return ofType(await turn(), "tool_call_result")[0]!.summary;
    };

    it("counts what a reconcile found", async () => {
      expect(await run("reconcile_statement", { summary: { new: 12, duplicate: 3, changed: 1, fuzzyMatch: 2 } })).toBe("12 novas · 3 duplicadas · 1 mudaram · 2 para revisar");
    });

    it("counts what a commit imported", async () => {
      expect(await run("commit_plan", { planId: "p", imported: 42 })).toBe("42 transações importadas");
    });

    it("counts what a search found, for transactions and for transfers", async () => {
      expect(await run("search_transactions", { total: 7 })).toBe("7 encontradas");
      expect(await run("search_transfers", { total: 0 })).toBe("0 encontradas");
    });

    it("says nothing when the output lacks the number", async () => {
      expect(await run("reconcile_statement", { rows: [] })).toBeUndefined();
      expect(await run("commit_plan", { planId: "p", imported: "many" })).toBeUndefined();
      expect(await run("search_transactions", { total: "7" })).toBeUndefined();
    });

    it("says nothing for a tool with no summary, or an output that is empty", async () => {
      expect(await run("get_context_snapshot", { accounts: [] })).toBeUndefined();
      expect(await run("get_parsed_rows", undefined)).toBeUndefined();
    });

    it("gives no summary for a call that failed", async () => {
      model.replies = [{ content: [toolUse("tu", "search_transactions")] }, reply(text("ok"))];
      vi.mocked(executeTool).mockResolvedValueOnce(toolResult("search_transactions", { total: 5 }, { isError: true }));
      expect(ofType(await turn(), "tool_call_result")[0]).toMatchObject({ status: "error", summary: undefined });
    });
  });

  describe("what the interface is told besides the call", () => {
    const planOutput = { planId: "plan-1", kind: "import", summary: { newTransactionCount: 3 }, payloadHash: "hash-1", warnings: ["aviso"] };

    it.each(["propose_import_plan", "update_import_plan", "propose_revert_plan"])("announces the plan a %s proposed", async (name) => {
      model.replies = [{ content: [toolUse("tu", name)] }, reply(text("ok"))];
      vi.mocked(executeTool).mockResolvedValueOnce(toolResult(name, planOutput));

      const events = await turn();

      const [assistantMessageId] = ofType(events, "message_created").slice(1).map((event) => event.message.id);
      expect(ofType(events, "plan_proposed")).toEqual([
        { type: "plan_proposed", messageId: assistantMessageId, planId: "plan-1", kind: "import", summary: { newTransactionCount: 3 }, payloadHash: "hash-1", warnings: ["aviso"] },
      ]);
    });

    it("announces a committed plan with the whole result", async () => {
      const output = { planId: "plan-1", imported: 3, batchId: "b1" };
      model.replies = [{ content: [toolUse("tu", "commit_plan")] }, reply(text("ok"))];
      vi.mocked(executeTool).mockResolvedValueOnce(toolResult("commit_plan", output));

      const events = await turn();

      expect(ofType(events, "plan_committed")).toEqual([
        { type: "plan_committed", messageId: expect.any(String), planId: "plan-1", kind: "import", result: output },
      ]);
      expect(ofType(events, "plan_proposed")).toEqual([]);
    });

    it("shows the card a present_card built", async () => {
      const card = { cardId: "c1", type: "duplicate_review", pairs: [] };
      model.replies = [{ content: [toolUse("tu", "present_card")] }, reply(text("ok"))];
      vi.mocked(executeTool).mockResolvedValueOnce(toolResult("present_card", card));

      const events = await turn();

      expect(ofType(events, "action_card")).toEqual([{ type: "action_card", messageId: expect.any(String), card }]);
    });

    it("announces nothing for a plan tool that failed", async () => {
      model.replies = [{ content: [toolUse("t1", "propose_import_plan"), toolUse("t2", "commit_plan"), toolUse("t3", "present_card")] }, reply(text("ok"))];
      vi.mocked(executeTool)
        .mockResolvedValueOnce(toolResult("propose_import_plan", { error: "x" }, { isError: true }))
        .mockResolvedValueOnce(toolResult("commit_plan", { error: "x" }, { isError: true }))
        .mockResolvedValueOnce(toolResult("present_card", { error: "x" }, { isError: true }));

      const events = await turn();

      expect(events.map((event) => event.type)).not.toContain("plan_proposed");
      expect(events.map((event) => event.type)).not.toContain("plan_committed");
      expect(events.map((event) => event.type)).not.toContain("action_card");
      expect(ofType(events, "tool_call_result").map((event) => event.status)).toEqual(["error", "error", "error"]);
    });
  });

  describe("a tool that hands back files for the model to see", () => {
    const media = [
      { attachmentId: "f1", originalName: "recibo.png", blobUrl: "https://blob.test/recibo.png", mediaType: "image/png" },
      { attachmentId: "f2", originalName: "sumiu.png", blobUrl: "https://blob.test/sumiu.png", mediaType: "image/png" },
    ];

    it("inlines what it can load, apologises for what it cannot, and stores only references", async () => {
      vi.mocked(getObjectBuffer).mockImplementation(async (url: string) => {
        if (url.endsWith("sumiu.png")) throw new Error("not found");
        return Buffer.from("PNGBYTES");
      });
      model.replies = [{ content: [toolUse("tu", "read_attachment")] }, reply(text("ok"))];
      vi.mocked(executeTool).mockResolvedValueOnce(toolResult("read_attachment", { files: 2 }, { media }));

      await turn();

      const summary = { type: "text", text: JSON.stringify({ files: 2 }) };
      // The model gets the image, and a note where the second one could not be read.
      const sent = requests()[1]!.messages.at(-1)!.content as Array<{ tool_use_id: string; content: unknown[]; is_error: boolean }>;
      expect(sent).toEqual([
        {
          type: "tool_result",
          tool_use_id: "tu",
          is_error: false,
          content: [
            summary,
            { type: "image", source: { type: "base64", media_type: "image/png", data: Buffer.from("PNGBYTES").toString("base64") } },
            { type: "text", text: '[Não foi possível carregar o anexo "sumiu.png".]' },
          ],
        },
      ]);
      // The database gets the references and no bytes.
      const stored = (await savedMessages()).find((row) => row.kind === "tool_results")!;
      expect(stored.content).toEqual([
        {
          type: "tool_result",
          tool_use_id: "tu",
          is_error: false,
          content: [
            summary,
            { type: "capital_file_ref", fileId: "f1", originalName: "recibo.png", blobUrl: "https://blob.test/recibo.png", mediaType: "image/png" },
            { type: "capital_file_ref", fileId: "f2", originalName: "sumiu.png", blobUrl: "https://blob.test/sumiu.png", mediaType: "image/png" },
          ],
        },
      ]);
      expect(JSON.stringify(stored.content)).not.toContain(Buffer.from("PNGBYTES").toString("base64"));
    });

    it("treats an empty media list as no media", async () => {
      model.replies = [{ content: [toolUse("tu", "read_attachment")] }, reply(text("ok"))];
      vi.mocked(executeTool).mockResolvedValueOnce(toolResult("read_attachment", { files: 0 }, { media: [] }));

      await turn();

      const stored = (await savedMessages()).find((row) => row.kind === "tool_results")!;
      expect(stored.content).toEqual([{ type: "tool_result", tool_use_id: "tu", content: JSON.stringify({ files: 0 }), is_error: false }]);
    });
  });
});

describe("web search, which the model runs itself", () => {
  it("shows the search and the number of results, and saves the answer as it came", async () => {
    const content = [
      { type: "server_tool_use", id: "ws1", name: "web_search", input: { query: "CNPJ da Padaria Estrela" } },
      { type: "web_search_tool_result", tool_use_id: "ws1", content: [{ type: "web_search_result" }, { type: "web_search_result" }, { type: "web_search_result" }] },
      text("É uma padaria."),
    ];
    model.replies = [{ content }];

    const events = await turn();

    const [, assistantCreated] = ofType(events, "message_created");
    const messageId = assistantCreated!.message.id;
    expect(ofType(events, "tool_call_started")).toEqual([
      { type: "tool_call_started", messageId, toolCallId: "ws1", tool: "web_search", label: "Pesquisando: CNPJ da Padaria Estrela" },
    ]);
    expect(ofType(events, "tool_call_result")).toEqual([
      { type: "tool_call_result", messageId, toolCallId: "ws1", tool: "web_search", status: "success", summary: "3 resultados" },
    ]);
    // After the message is complete, before the turn ends.
    const types = events.map((event) => event.type);
    expect(types.indexOf("message_complete")).toBeLessThan(types.indexOf("tool_call_started"));
    expect(types.indexOf("tool_call_result")).toBeLessThan(types.indexOf("turn_completed"));
    expect(executeTool).not.toHaveBeenCalled();
    const [, assistant] = await savedMessages();
    expect(assistant!.content).toEqual(content);
  });

  it("marks a search that came back as an error, and names one without a query generically", async () => {
    model.replies = [
      {
        content: [
          { type: "server_tool_use", id: "ws1", name: "web_search", input: {} },
          { type: "web_search_tool_result", tool_use_id: "ws1", content: { type: "web_search_tool_result_error", error_code: "unavailable" } },
        ],
      },
    ];

    const events = await turn();

    expect(ofType(events, "tool_call_started")[0]).toMatchObject({ label: "Pesquisando na web" });
    expect(ofType(events, "tool_call_result")).toEqual([
      expect.objectContaining({ toolCallId: "ws1", status: "error", summary: undefined }),
    ]);
  });

  it("reports a search with no result block yet as a success without a count", async () => {
    model.replies = [{ content: [{ type: "server_tool_use", id: "ws1", name: "web_search", input: { query: "x" } }] }];

    const events = await turn();

    expect(ofType(events, "tool_call_result")).toEqual([
      expect.objectContaining({ toolCallId: "ws1", status: "success", summary: undefined }),
    ]);
  });

  it("matches each search to its own result and ignores other server tools", async () => {
    model.replies = [
      {
        content: [
          { type: "server_tool_use", id: "ws1", name: "web_search", input: { query: "um" } },
          { type: "server_tool_use", id: "ws2", name: "web_search", input: { query: "dois" } },
          { type: "server_tool_use", id: "cx", name: "code_execution", input: { code: "1+1" } },
          { type: "web_search_tool_result", tool_use_id: "ws2", content: [{}, {}] },
          { type: "web_search_tool_result", tool_use_id: "ws1", content: [{}] },
        ],
      },
    ];

    const events = await turn();

    expect(ofType(events, "tool_call_started").map((event) => [event.toolCallId, event.label])).toEqual([
      ["ws1", "Pesquisando: um"],
      ["ws2", "Pesquisando: dois"],
    ]);
    expect(ofType(events, "tool_call_result").map((event) => [event.toolCallId, event.summary])).toEqual([
      ["ws1", "1 resultados"],
      ["ws2", "2 resultados"],
    ]);
  });
});

describe("limits", () => {
  it("lets a turn that ends in an answer finish with no limit message", async () => {
    model.replies = [{ content: [toolUse("tu1", "not_a_real_tool")] }, reply(text("pronto"))];
    const events = await turn();
    expect(ofType(events, "error")).toEqual([]);
    expect((await savedTurn()).error).toBeNull();
  });

  it("reports the cost budget exactly when a round of tools reaches it", async () => {
    model.replies = [{ content: [toolUse("tu1", "not_a_real_tool")], usage: { output_tokens: Math.ceil(env.ASSISTANT_MAX_TURN_COST_USD * 1_000_000) } }, reply(text("nunca"))];

    const events = await turn();

    expect(requests()).toHaveLength(1);
    expect(ofType(events, "error")).toEqual([expect.objectContaining({ code: "TURN_LIMIT", retryable: false })]);
    expect(events.at(-1)).toMatchObject({ type: "turn_completed", status: "completed" });
  });
});
