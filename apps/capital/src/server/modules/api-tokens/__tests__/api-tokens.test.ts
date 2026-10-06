import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { POST as mcpPost } from "@/app/mcp/route";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import { generateToken, hashToken, LAST_USED_THROTTLE_MS } from "../services/tokens";
import { isReadOnlyTool } from "@capital/server/modules/mcp/lib/auth";

/** /v2/api-tokens CRUD and the MCP route authenticating with those tokens. */
const USER = "test-user-s6-api-tokens-001";
const app = createApp();
let cookie: string;

const call = async (path: string, init: { method?: string; body?: unknown } = {}) => {
  const res = await app.request(`/api${path}`, {
    method: init.method ?? "GET",
    headers: { cookie, "content-type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  return { status: res.status, body: await res.json() };
};

let rpcId = 0;
async function mcp(token: string | null, method: string, params: Record<string, unknown> = {}) {
  const body = JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params });
  const res = await mcpPost(
    new NextRequest("http://localhost/mcp", {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body,
    })
  );
  const text = await res.text();
  return { status: res.status, json: text.startsWith("{") ? JSON.parse(text) : null };
}

const initialize = (token: string, name = "Cursor") =>
  mcp(token, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name, version: "1.7.0" } });

const envBackup = { key: process.env.MCP_API_KEY, user: process.env.MCP_USER_ID };

beforeEach(async () => {
  await createLedgerFixture(prisma, USER);
  const session = await prisma.session.create({ data: { userId: USER, expiresAt: new Date(Date.now() + 3600_000) } });
  cookie = `capital_session=${session.id}`;
});

afterEach(() => {
  process.env.MCP_API_KEY = envBackup.key;
  process.env.MCP_USER_ID = envBackup.user;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("token format", () => {
  it("is cap_live_ plus 32 base62 characters, stored only as a sha256 hash", () => {
    const token = generateToken();
    expect(token).toMatch(/^cap_live_[0-9A-Za-z]{32}$/);
    expect(generateToken()).not.toBe(token);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats list/get/find/search tools and readOnlyHint as read tools", () => {
    expect(isReadOnlyTool("list_transactions")).toBe(true);
    expect(isReadOnlyTool("get_budget_status")).toBe(true);
    expect(isReadOnlyTool("delete_transaction")).toBe(false);
    expect(isReadOnlyTool("import_credit_card_statement")).toBe(false);
    expect(isReadOnlyTool("portfolio_overview", { annotations: { readOnlyHint: true } })).toBe(true);
  });
});

describe("/v2/api-tokens", () => {
  it("shows the plaintext once, then only the masked token", async () => {
    const created = await call("/v2/api-tokens", { method: "POST", body: {} });
    expect(created.status).toBe(200);
    const { token, apiToken } = created.body;
    expect(token).toMatch(/^cap_live_/);
    expect(apiToken).toMatchObject({ name: "MCP", readOnly: false, masked: `cap_live_••••••••••••${token.slice(-4)}`, lastUsedAt: null, clients: [] });
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } });
    expect(row.tokenHash).toBe(hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    const listed = await call("/v2/api-tokens");
    expect(JSON.stringify(listed.body)).not.toContain(token);
    expect(listed.body.tokens).toHaveLength(1);
  });

  it("revokes a token and refuses another user's", async () => {
    const { apiToken } = (await call("/v2/api-tokens", { method: "POST", body: { readOnly: true, name: "Claude Desktop" } })).body;
    expect(apiToken).toMatchObject({ readOnly: true, name: "Claude Desktop" });
    expect((await call(`/v2/api-tokens/${apiToken.id}`, { method: "DELETE" })).body).toEqual({ ok: true, id: apiToken.id });
    expect((await call("/v2/api-tokens")).body.tokens).toEqual([]);
    expect((await call(`/v2/api-tokens/${apiToken.id}`, { method: "DELETE" })).body.code).toBe("tokens.not_found");
  });

  it("switches a token between read-only and read + write", async () => {
    const { apiToken } = (await call("/v2/api-tokens", { method: "POST", body: {} })).body;
    expect((await call(`/v2/api-tokens/${apiToken.id}`, { method: "PATCH", body: { readOnly: true } })).body.readOnly).toBe(true);
    expect((await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } })).scopes).toEqual(["read"]);
    expect((await call(`/v2/api-tokens/${apiToken.id}`, { method: "PATCH", body: { readOnly: false, name: "Cursor" } })).body).toMatchObject({ readOnly: false, name: "Cursor" });
  });
});

describe("MCP authentication with API tokens", () => {
  it("authenticates by token, records the client and its last use", async () => {
    const { token, apiToken } = (await call("/v2/api-tokens", { method: "POST", body: {} })).body;
    const init = await initialize(token);
    expect(init.status).toBe(200);
    expect(init.json.result.serverInfo.name).toBe("capital-accounting");
    const tools = await mcp(token, "tools/list");
    const names: string[] = tools.json.result.tools.map((t: { name: string }) => t.name);
    expect(names).toContain("delete_transaction");
    expect(names).toContain("list_transactions");

    const listed = (await call("/v2/api-tokens")).body.tokens[0];
    expect(listed.id).toBe(apiToken.id);
    expect(listed.lastUsedAt).not.toBeNull();
    expect(listed.clients).toEqual([expect.objectContaining({ clientName: "Cursor", clientVersion: "1.7.0" })]);
  });

  it("gives a read-only token only the read tools", async () => {
    const { token } = (await call("/v2/api-tokens", { method: "POST", body: { readOnly: true } })).body;
    await initialize(token, "Claude Desktop");
    const names: string[] = (await mcp(token, "tools/list")).json.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThan(5);
    expect(names.every((n) => /^(list|get|find|search)_/.test(n))).toBe(true);
    const write = await mcp(token, "tools/call", { name: "delete_transaction", arguments: { id: "x" } });
    expect(write.json.error ?? write.json.result?.isError).toBeTruthy();
  });

  it("answers 401 to a missing, unknown or revoked token", async () => {
    expect((await mcp(null, "tools/list")).status).toBe(401);
    expect((await mcp("cap_live_nope", "tools/list")).status).toBe(401);
    const { token, apiToken } = (await call("/v2/api-tokens", { method: "POST", body: {} })).body;
    expect((await mcp(token, "tools/list")).status).toBe(200);
    await call(`/v2/api-tokens/${apiToken.id}`, { method: "DELETE" });
    expect((await mcp(token, "tools/list")).status).toBe(401);
  });

  it("keeps the server's MCP_API_KEY as a fallback", async () => {
    process.env.MCP_API_KEY = "s6-env-key-for-tests";
    process.env.MCP_USER_ID = USER;
    expect((await mcp("s6-env-key-for-tests", "tools/list")).status).toBe(200);
    delete process.env.MCP_USER_ID;
    expect((await mcp("s6-env-key-for-tests", "tools/list")).status).toBe(500);
  });

  it("throttles the lastUsedAt write", async () => {
    const { token, apiToken } = (await call("/v2/api-tokens", { method: "POST", body: {} })).body;
    await mcp(token, "tools/list");
    const first = (await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } })).lastUsedAt!;
    await mcp(token, "tools/list");
    expect((await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } })).lastUsedAt).toEqual(first);
    expect(LAST_USED_THROTTLE_MS).toBeGreaterThan(0);
  });
});
