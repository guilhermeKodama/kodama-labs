import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { createSseParser, parseAgentEvent } from "@/lib/assistant/sse";
import type { AgentEvent } from "../../../agent/events";

/**
 * The assistant's HTTP surface end to end: real app, real session cookie,
 * real Postgres. The model is a scripted fake and the blob store a
 * recorder, so nothing leaves the machine.
 */

const model = vi.hoisted(() => ({
  replies: [] as Array<{ content: unknown[]; usage?: Partial<Anthropic.Usage> } | Error>,
  requests: [] as unknown[][],
}));
const blob = vi.hoisted(() => ({
  putObject: vi
    .fn<(pathname: string, body: Buffer, contentType: string) => Promise<{ url: string; pathname: string }>>()
    .mockImplementation(async (pathname) => ({ url: `https://blob.test/${pathname}`, pathname })),
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
      create: async () => ({ content: [{ type: "text", text: "Título gerado" }] }),
    },
  };
  return { ...actual, getAnthropicClient: () => client };
});
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, putObject: blob.putObject };
});

const ME = "test-user-assistant-routes-001";
const OTHER = "test-user-assistant-routes-002";
const MISSING = "00000000-0000-0000-0000-000000000000";
const base = "/v1/assistant/conversations";

const app = createApp();
let cookie: string;
let otherCookie: string;

type Json = Record<string, unknown>;

async function call<T = Json>(method: string, path: string, init: { body?: unknown; form?: FormData; as?: string | null } = {}) {
  const cookieHeader = init.as === null ? undefined : (init.as ?? cookie);
  const res = await app.request(`/api${path}`, {
    method,
    headers: {
      ...(cookieHeader && { cookie: cookieHeader }),
      ...(init.body !== undefined && { "content-type": "application/json" }),
    },
    body: init.form ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
  });
  return { status: res.status, body: (await res.json()) as T };
}

async function stream(path: string, body: unknown, rawBody?: string) {
  const res = await app.request(`/api${path}`, {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: rawBody ?? JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.headers.get("content-type")?.includes("text/event-stream")) {
    return { status: res.status, events: [] as AgentEvent[], json: JSON.parse(text) as Json };
  }
  const parser = createSseParser();
  const events = [...parser.push(text), ...parser.flush()].map(parseAgentEvent).filter((event): event is AgentEvent => event !== null);
  return { status: res.status, events, json: null };
}

async function newConversation(userId = ME, data: { title?: string | null; status?: "active" | "archived"; lastMessageAt?: Date } = {}) {
  return prisma.agentConversation.create({ data: { userId, title: data.title === undefined ? "Teste" : data.title, ...data }, select: { id: true } });
}

async function createUser(id: string) {
  await prisma.user.deleteMany({ where: { id } });
  await prisma.user.create({ data: { id, email: `${id}@example.com`, passwordHash: "x", name: id } });
  const session = await prisma.session.create({ data: { userId: id, expiresAt: new Date(Date.now() + 3600_000) } });
  return `capital_session=${session.id}`;
}

beforeAll(async () => {
  cookie = await createUser(ME);
  otherCookie = await createUser(OTHER);
});

beforeEach(async () => {
  model.replies = [];
  model.requests = [];
  blob.putObject.mockClear();
  await prisma.agentConversation.deleteMany({ where: { userId: { in: [ME, OTHER] } } });
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [ME, OTHER] } } });
});

describe("authentication", () => {
  it("answers 401 to every assistant route without a session", async () => {
    const cases: Array<[string, string, unknown?]> = [
      ["GET", base],
      ["POST", base, {}],
      ["GET", `${base}/${MISSING}`],
      ["DELETE", `${base}/${MISSING}`],
      ["POST", `${base}/${MISSING}/cancel`],
      ["POST", `${base}/${MISSING}/messages`, { text: "oi" }],
      ["POST", `${base}/${MISSING}/retry`],
      ["POST", `${base}/${MISSING}/plans/${MISSING}/confirm`, { payloadHash: "x" }],
      ["POST", `${base}/${MISSING}/plans/${MISSING}/reject`],
    ];
    for (const [method, path, body] of cases) {
      const res = await call(method, path, { body, as: null });
      expect(res, `${method} ${path}`).toMatchObject({ status: 401, body: { code: "auth.required" } });
    }
  });

  it("answers 401 to a session that does not exist", async () => {
    const res = await call("GET", base, { as: "capital_session=not-a-session" });
    expect(res).toMatchObject({ status: 401, body: { code: "auth.session_invalid" } });
  });
});

describe("POST /v1/assistant/conversations", () => {
  it("creates an active conversation with the given title", async () => {
    const res = await call(`POST`, base, { body: { title: "Importar março" } });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      title: "Importar março",
      status: "active",
      lastMessageAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
      createdAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T.*Z$/),
    });
    const row = await prisma.agentConversation.findUniqueOrThrow({ where: { id: res.body.id as string } });
    expect(row).toMatchObject({ userId: ME, title: "Importar março", status: "active" });
  });

  it("creates an untitled conversation when no title is sent", async () => {
    const res = await call("POST", base, { body: {} });
    expect(res.status).toBe(201);
    expect(res.body.title).toBeNull();
  });

  it("rejects an empty title and creates nothing", async () => {
    const res = await call("POST", base, { body: { title: "" } });
    expect(res).toMatchObject({ status: 422, body: { code: "validation", issues: [expect.objectContaining({ path: "title" })] } });
    expect(await prisma.agentConversation.count({ where: { userId: ME } })).toBe(0);
  });
});

describe("GET /v1/assistant/conversations", () => {
  it("lists only the user's active conversations, most recently active first", async () => {
    const old = await newConversation(ME, { title: "Antiga", lastMessageAt: new Date("2026-01-01T10:00:00Z") });
    const recent = await newConversation(ME, { title: "Recente", lastMessageAt: new Date("2026-03-01T10:00:00Z") });
    await newConversation(ME, { title: "Arquivada", status: "archived", lastMessageAt: new Date("2026-04-01T10:00:00Z") });
    await newConversation(OTHER, { title: "De outro", lastMessageAt: new Date("2026-05-01T10:00:00Z") });

    const res = await call<Json[]>("GET", base);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: recent.id, title: "Recente", status: "active", lastMessageAt: "2026-03-01T10:00:00.000Z", createdAt: expect.any(String) },
      { id: old.id, title: "Antiga", status: "active", lastMessageAt: "2026-01-01T10:00:00.000Z", createdAt: expect.any(String) },
    ]);
  });

  it("pages with limit and cursor", async () => {
    const ids: string[] = [];
    for (let day = 1; day <= 3; day++) {
      ids.push((await newConversation(ME, { title: `C${day}`, lastMessageAt: new Date(`2026-02-0${day}T10:00:00Z`) })).id);
    }
    const [c1, c2, c3] = ids as [string, string, string];

    const first = await call<Json[]>("GET", `${base}?limit=2`);
    expect(first.body.map((c) => c.id)).toEqual([c3, c2]);

    const next = await call<Json[]>("GET", `${base}?limit=2&cursor=${c2}`);
    expect(next.body.map((c) => c.id)).toEqual([c1]);
  });

  it("rejects a limit that is not between 1 and 100", async () => {
    for (const limit of ["0", "101", "abc"]) {
      const res = await call("GET", `${base}?limit=${limit}`);
      expect(res, `limit=${limit}`).toMatchObject({ status: 422, body: { code: "validation" } });
    }
  });
});

describe("GET /v1/assistant/conversations/:id", () => {
  it("returns the resume payload: messages, files, plans (newest first) and turns", async () => {
    const { id } = await newConversation(ME, { title: "Detalhe" });
    const turn = await prisma.agentTurn.create({
      data: {
        conversationId: id,
        model: "claude-test",
        status: "failed",
        inputTokens: 100,
        outputTokens: 50,
        costUsd: 0.123456,
        error: "credit balance is too low",
        createdAt: new Date("2026-02-01T10:00:00Z"),
        completedAt: new Date("2026-02-01T10:00:05Z"),
      },
    });
    const running = await prisma.agentTurn.create({
      data: { conversationId: id, model: "claude-test", createdAt: new Date("2026-02-01T11:00:00Z") },
    });
    const user = await prisma.agentMessage.create({
      data: { conversationId: id, turnId: turn.id, role: "user", kind: "user_text", content: [{ type: "text", text: "oi" }], createdAt: new Date("2026-02-01T10:00:01Z") },
    });
    const assistant = await prisma.agentMessage.create({
      data: { conversationId: id, role: "assistant", kind: "assistant", content: [{ type: "text", text: "olá" }], createdAt: new Date("2026-02-01T10:00:02Z") },
    });
    const file = await prisma.conversationFile.create({
      data: {
        conversationId: id,
        userId: ME,
        fileType: "ofx",
        statementKind: "bank_ofx",
        blobUrl: "https://blob.test/x.ofx",
        pathname: "x.ofx",
        mimeType: "text/plain",
        sizeBytes: 321,
        originalName: "extrato.ofx",
        parseStatus: "failed",
        parseError: "No STMTRS block found in OFX file",
        createdAt: new Date("2026-02-01T10:00:00Z"),
      },
    });
    const older = await prisma.importPlan.create({
      data: { conversationId: id, userId: ME, payload: { a: 1 }, payloadHash: "h-old", summary: { n: 1 }, createdAt: new Date("2026-02-01T10:01:00Z") },
    });
    const newer = await prisma.importPlan.create({
      data: {
        conversationId: id,
        userId: ME,
        kind: "revert",
        status: "committed",
        fileId: file.id,
        payload: { b: 2 },
        payloadHash: "h-new",
        summary: { n: 2 },
        warnings: ["cuidado"],
        confirmedAt: new Date("2026-02-01T10:03:00Z"),
        committedAt: new Date("2026-02-01T10:04:00Z"),
        createdAt: new Date("2026-02-01T10:02:00Z"),
      },
    });

    const res = await call("GET", `${base}/${id}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id,
      title: "Detalhe",
      status: "active",
      messages: [
        { id: user.id, turnId: turn.id, role: "user", content: [{ type: "text", text: "oi" }], kind: "user_text", createdAt: "2026-02-01T10:00:01.000Z" },
        { id: assistant.id, turnId: null, role: "assistant", content: [{ type: "text", text: "olá" }], kind: "assistant", createdAt: "2026-02-01T10:00:02.000Z" },
      ],
      files: [
        {
          id: file.id,
          fileType: "ofx",
          statementKind: "bank_ofx",
          originalName: "extrato.ofx",
          mimeType: "text/plain",
          blobUrl: "https://blob.test/x.ofx",
          sizeBytes: 321,
          parseStatus: "failed",
          parseError: "No STMTRS block found in OFX file",
          createdAt: "2026-02-01T10:00:00.000Z",
        },
      ],
      plans: [
        {
          id: newer.id,
          kind: "revert",
          status: "committed",
          fileId: file.id,
          payload: { b: 2 },
          payloadHash: "h-new",
          summary: { n: 2 },
          warnings: ["cuidado"],
          confirmedAt: "2026-02-01T10:03:00.000Z",
          committedAt: "2026-02-01T10:04:00.000Z",
          createdAt: "2026-02-01T10:02:00.000Z",
        },
        {
          id: older.id,
          kind: "import",
          status: "proposed",
          fileId: null,
          payload: { a: 1 },
          payloadHash: "h-old",
          summary: { n: 1 },
          warnings: [],
          confirmedAt: null,
          committedAt: null,
          createdAt: "2026-02-01T10:01:00.000Z",
        },
      ],
      turns: [
        {
          id: turn.id,
          status: "failed",
          model: "claude-test",
          inputTokens: 100,
          outputTokens: 50,
          costUsd: 0.123456,
          createdAt: "2026-02-01T10:00:00.000Z",
          completedAt: "2026-02-01T10:00:05.000Z",
          error: "credit balance is too low",
        },
        {
          id: running.id,
          status: "running",
          model: "claude-test",
          inputTokens: 0,
          outputTokens: 0,
          costUsd: 0,
          createdAt: "2026-02-01T11:00:00.000Z",
          completedAt: null,
          error: null,
        },
      ],
    });
  });

  it("returns an empty conversation as empty lists", async () => {
    const { id } = await newConversation(ME, { title: null });
    const res = await call("GET", `${base}/${id}`);
    expect(res.body).toEqual({ id, title: null, status: "active", messages: [], files: [], plans: [], turns: [] });
  });

  it("is 404 for a conversation of another user and for one that does not exist", async () => {
    const theirs = await newConversation(OTHER);
    expect(await call("GET", `${base}/${theirs.id}`)).toEqual({
      status: 404,
      body: { message: "Conversation not found or access denied", code: "assistant.conversation_not_found" },
    });
    expect((await call("GET", `${base}/${MISSING}`)).status).toBe(404);
    // Its owner still reads it.
    expect((await call("GET", `${base}/${theirs.id}`, { as: otherCookie })).status).toBe(200);
  });
});

describe("DELETE /v1/assistant/conversations/:id", () => {
  it("archives the conversation: it leaves the list but stays in the database", async () => {
    const { id } = await newConversation();

    const res = await call("DELETE", `${base}/${id}`);

    expect(res).toEqual({ status: 200, body: { message: "Conversation archived" } });
    expect((await prisma.agentConversation.findUniqueOrThrow({ where: { id } })).status).toBe("archived");
    expect((await call<Json[]>("GET", base)).body).toEqual([]);
  });

  it("is 404 for a conversation of another user, which stays active", async () => {
    const theirs = await newConversation(OTHER);

    const res = await call("DELETE", `${base}/${theirs.id}`);

    expect(res).toMatchObject({ status: 404, body: { code: "assistant.conversation_not_found" } });
    expect((await prisma.agentConversation.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("active");
  });

  it("is 404 for a conversation that does not exist", async () => {
    expect((await call("DELETE", `${base}/${MISSING}`)).status).toBe(404);
  });
});

describe("POST /v1/assistant/conversations/:id/files", () => {
  const OFX = [
    "OFXHEADER:100",
    "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL",
    "<BANKACCTFROM><BANKID>1<ACCTID>1<ACCTTYPE>CHECKING</BANKACCTFROM>",
    "<BANKTRANLIST><DTSTART>20260101<DTEND>20260131",
    "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-10.00<FITID>fit-1<MEMO>Compra</STMTTRN>",
    "</BANKTRANLIST><LEDGERBAL><BALAMT>90.00<DTASOF>20260131</LEDGERBAL>",
    "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
  ].join("\n");

  const formWith = (content: string, name: string, type: string) => {
    const form = new FormData();
    form.set("file", new File([content], name, { type }));
    return form;
  };

  it("stores and parses the file and answers 201 with its description", async () => {
    const { id } = await newConversation();

    const res = await call("POST", `${base}/${id}/files`, { form: formWith(OFX, "extrato.ofx", "text/plain") });

    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      id: expect.any(String),
      fileType: "ofx",
      statementKind: "bank_ofx",
      originalName: "extrato.ofx",
      mimeType: "text/plain",
      blobUrl: expect.stringContaining(`capital/conversations/${id}/`),
      sizeBytes: Buffer.byteLength(OFX),
      parseStatus: "parsed",
      parseError: null,
    });
    expect(blob.putObject).toHaveBeenCalledTimes(1);
    const row = await prisma.conversationFile.findUniqueOrThrow({ where: { id: res.body.id as string } });
    expect(row).toMatchObject({ conversationId: id, userId: ME, parseStatus: "parsed" });
  });

  it("answers 400 when the form has no file", async () => {
    const { id } = await newConversation();
    const form = new FormData();
    form.set("file", "um texto, não um arquivo");

    const res = await call("POST", `${base}/${id}/files`, { form });

    expect(res).toEqual({ status: 400, body: { message: "file is required", code: "assistant.file_required" } });
    expect(blob.putObject).not.toHaveBeenCalled();
  });

  it("answers 422 for a file type that is not supported", async () => {
    const { id } = await newConversation();

    const res = await call("POST", `${base}/${id}/files`, { form: formWith("só texto", "notas.txt", "text/plain") });

    expect(res).toMatchObject({ status: 422, body: { code: "assistant.file_type_unsupported" } });
    expect(await prisma.conversationFile.count({ where: { conversationId: id } })).toBe(0);
  });

  it("answers 404 for a conversation of another user and saves nothing", async () => {
    const theirs = await newConversation(OTHER);

    const res = await call("POST", `${base}/${theirs.id}/files`, { form: formWith(OFX, "extrato.ofx", "text/plain") });

    expect(res).toMatchObject({ status: 404, body: { code: "assistant.conversation_not_found" } });
    expect(await prisma.conversationFile.count({ where: { conversationId: theirs.id } })).toBe(0);
  });
});

describe("POST /v1/assistant/conversations/:id/cancel", () => {
  it("cancels the running turn", async () => {
    const { id } = await newConversation();
    const running = await prisma.agentTurn.create({ data: { conversationId: id, model: "claude-test" } });
    const done = await prisma.agentTurn.create({ data: { conversationId: id, model: "claude-test", status: "completed" } });

    const res = await call("POST", `${base}/${id}/cancel`);

    expect(res).toEqual({ status: 200, body: { message: "Turn cancelled", turnId: running.id } });
    expect((await prisma.agentTurn.findUniqueOrThrow({ where: { id: running.id } })).status).toBe("cancelled");
    expect((await prisma.agentTurn.findUniqueOrThrow({ where: { id: done.id } })).status).toBe("completed");
  });

  it("says so when no turn is running", async () => {
    const { id } = await newConversation();
    await prisma.agentTurn.create({ data: { conversationId: id, model: "claude-test", status: "completed" } });

    expect(await call("POST", `${base}/${id}/cancel`)).toEqual({ status: 200, body: { message: "No turn was running", turnId: null } });
  });

  it("is 404 for a conversation of another user and leaves its turn running", async () => {
    const theirs = await newConversation(OTHER);
    const turn = await prisma.agentTurn.create({ data: { conversationId: theirs.id, model: "claude-test" } });

    const res = await call("POST", `${base}/${theirs.id}/cancel`);

    expect(res).toEqual({ status: 404, body: { message: "Conversation not found", code: "assistant.conversation_not_found" } });
    expect((await prisma.agentTurn.findUniqueOrThrow({ where: { id: turn.id } })).status).toBe("running");
  });
});

describe("plan confirmation", () => {
  async function proposedPlan(userId = ME, overrides: { status?: "proposed" | "committed" | "rejected" } = {}) {
    const { id: conversationId } = await newConversation(userId);
    const plan = await prisma.importPlan.create({
      data: { conversationId, userId, payload: { x: 1 }, payloadHash: "hash-ok", summary: {}, ...overrides },
    });
    return { conversationId, planId: plan.id };
  }
  const confirm = (conversationId: string, planId: string, payloadHash: string, as?: string) =>
    call("POST", `${base}/${conversationId}/plans/${planId}/confirm`, { body: { payloadHash }, as });
  const reject = (conversationId: string, planId: string, as?: string) =>
    call("POST", `${base}/${conversationId}/plans/${planId}/reject`, { as });

  it("confirms a proposed plan when the hash matches, and records how", async () => {
    const { conversationId, planId } = await proposedPlan();

    const res = await confirm(conversationId, planId, "hash-ok");

    expect(res).toEqual({ status: 200, body: { planId, status: "confirmed" } });
    const row = await prisma.importPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(row.status).toBe("confirmed");
    expect(row.confirmedVia).toBe("ui_button");
    expect(row.confirmedAt).toBeInstanceOf(Date);
    expect(Math.abs(Date.now() - row.confirmedAt!.getTime())).toBeLessThan(60_000);
    expect(row.committedAt).toBeNull();
  });

  it("refuses a hash that does not match, and the plan stays proposed", async () => {
    const { conversationId, planId } = await proposedPlan();

    const res = await confirm(conversationId, planId, "hash-of-another-plan");

    expect(res).toMatchObject({ status: 400, body: { code: "assistant.plan_changed" } });
    const row = await prisma.importPlan.findUniqueOrThrow({ where: { id: planId } });
    expect(row).toMatchObject({ status: "proposed", confirmedAt: null, confirmedVia: null });
  });

  it("refuses a plan that is no longer proposed", async () => {
    const committed = await proposedPlan(ME, { status: "committed" });

    expect(await confirm(committed.conversationId, committed.planId, "hash-ok")).toEqual({
      status: 400,
      body: { message: 'Plan is "committed", not "proposed"', code: "assistant.plan_not_proposed", params: { status: "committed" } },
    });
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: committed.planId } })).status).toBe("committed");
  });

  it("is 404 for a plan of another user and for one that does not exist", async () => {
    const theirs = await proposedPlan(OTHER);

    expect(await confirm(theirs.conversationId, theirs.planId, "hash-ok")).toMatchObject({ status: 404, body: { code: "assistant.plan_not_found" } });
    expect(await confirm(theirs.conversationId, MISSING, "hash-ok")).toMatchObject({ status: 404, body: { code: "assistant.plan_not_found" } });
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: theirs.planId } })).status).toBe("proposed");
  });

  it("requires a payloadHash in the body", async () => {
    const { conversationId, planId } = await proposedPlan();
    const res = await call("POST", `${base}/${conversationId}/plans/${planId}/confirm`, { body: {} });
    expect(res).toMatchObject({ status: 422, body: { code: "validation" } });
  });

  it("rejects a proposed plan, which can then never be confirmed", async () => {
    const { conversationId, planId } = await proposedPlan();

    expect(await reject(conversationId, planId)).toEqual({ status: 200, body: { planId, status: "rejected" } });
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: planId } })).status).toBe("rejected");

    expect(await confirm(conversationId, planId, "hash-ok")).toMatchObject({ status: 400, body: { code: "assistant.plan_not_proposed", params: { status: "rejected" } } });
    expect(await reject(conversationId, planId)).toMatchObject({ status: 400, body: { code: "assistant.plan_not_proposed" } });
  });

  it("does not reject a plan of another user", async () => {
    const theirs = await proposedPlan(OTHER);

    expect(await reject(theirs.conversationId, theirs.planId)).toMatchObject({ status: 404, body: { code: "assistant.plan_not_found" } });
    expect((await prisma.importPlan.findUniqueOrThrow({ where: { id: theirs.planId } })).status).toBe("proposed");
  });
});

describe("POST /v1/assistant/conversations/:id/messages", () => {
  const types = (events: AgentEvent[]) => events.map((event) => event.type);

  it("streams the turn and saves the user message and the answer", async () => {
    const { id } = await newConversation(ME, { title: "Já tem título" });
    model.replies = [{ content: [{ type: "text", text: "Olá! Como posso ajudar?" }] }];

    const res = await stream(`${base}/${id}/messages`, { text: "oi" });

    expect(res.status).toBe(200);
    expect(types(res.events)).toEqual([
      "turn_started",
      "message_created",
      "message_created",
      "message_complete",
      "turn_completed",
    ]);
    expect(res.events.at(-1)).toMatchObject({ type: "turn_completed", status: "completed", inputTokens: 10, outputTokens: 10 });
    const rows = await prisma.agentMessage.findMany({ where: { conversationId: id }, orderBy: { createdAt: "asc" } });
    expect(rows.map((row) => [row.role, row.kind, row.content])).toEqual([
      ["user", "user_text", [{ type: "text", text: "oi" }]],
      ["assistant", "assistant", [{ type: "text", text: "Olá! Como posso ajudar?" }]],
    ]);
    expect(await prisma.agentTurn.count({ where: { conversationId: id, status: "completed" } })).toBe(1);
  });

  it("names a conversation that has no title from its first message", async () => {
    const { id } = await newConversation(ME, { title: null });
    await stream(`${base}/${id}/messages`, { text: "importar o extrato de março" });
    expect((await prisma.agentConversation.findUniqueOrThrow({ where: { id } })).title).toBe("Título gerado");
  });

  it("saves a card answer as a card_response message and locks the card", async () => {
    const { id } = await newConversation();
    const cardResponse = { cardId: "card-1", decisions: [{ pairId: "p1", label: "Mesmo lançamento" }] };

    const res = await stream(`${base}/${id}/messages`, { cardResponse });

    expect(res.events).toContainEqual({ type: "card_locked", cardId: "card-1", decision: cardResponse.decisions });
    const user = await prisma.agentMessage.findFirstOrThrow({ where: { conversationId: id, role: "user" } });
    expect(user.kind).toBe("card_response");
    expect(user.content).toEqual([
      { type: "text", text: "[Resposta do usuário ao card duplicate_review, cardId=card-1]\n- p1: Mesmo lançamento" },
      { type: "capital_card_response", cardId: "card-1", decisions: cardResponse.decisions },
    ]);
  });

  it("is 404 for a conversation of another user, and nothing runs", async () => {
    const theirs = await newConversation(OTHER);

    const res = await stream(`${base}/${theirs.id}/messages`, { text: "oi" });

    expect(res).toMatchObject({ status: 404, json: { code: "assistant.conversation_not_found" } });
    expect(model.requests).toEqual([]);
    expect(await prisma.agentTurn.count({ where: { conversationId: theirs.id } })).toBe(0);
  });

  it("validates the body: 422 for an empty text, 400 when nothing is sent", async () => {
    const { id } = await newConversation();

    expect(await stream(`${base}/${id}/messages`, { text: "" })).toMatchObject({ status: 422, json: { code: "validation" } });
    expect(await stream(`${base}/${id}/messages`, { fileIds: [] })).toMatchObject({ status: 400, json: { code: "assistant.message_required" } });
    expect(await stream(`${base}/${id}/messages`, {})).toMatchObject({ status: 400, json: { code: "assistant.message_required" } });
    // A body that is not JSON is read as empty.
    expect(await stream(`${base}/${id}/messages`, null, "isto não é json")).toMatchObject({ status: 400, json: { code: "assistant.message_required" } });
    expect(model.requests).toEqual([]);
  });

  it("is 409 while another turn of the conversation is running", async () => {
    const { id } = await newConversation();
    await prisma.agentTurn.create({ data: { conversationId: id, model: "claude-test" } });

    const res = await stream(`${base}/${id}/messages`, { text: "oi" });

    expect(res).toMatchObject({ status: 409, json: { code: "assistant.turn_running" } });
    expect(await prisma.agentMessage.count({ where: { conversationId: id } })).toBe(0);
  });
});

describe("POST /v1/assistant/conversations/:id/retry", () => {
  it("is 409 while a turn of the conversation is running", async () => {
    const { id } = await newConversation();
    await prisma.agentTurn.create({ data: { conversationId: id, model: "claude-test" } });

    const res = await stream(`${base}/${id}/retry`, {});

    expect(res).toMatchObject({ status: 409, json: { code: "assistant.turn_running" } });
  });

  it("is 404 for a conversation of another user", async () => {
    const theirs = await newConversation(OTHER);
    expect(await stream(`${base}/${theirs.id}/retry`, {})).toMatchObject({ status: 404, json: { code: "assistant.conversation_not_found" } });
  });
});
