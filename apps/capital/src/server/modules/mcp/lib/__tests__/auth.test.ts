import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createApiToken, revokeApiToken } from "@capital/server/modules/api-tokens/services/tokens";
import { authenticateMcpRequest, initializeClientInfo, isReadOnlyTool, McpConfigError, recordMcpClient, type McpPrincipal } from "../auth";

const USER = "test-user-mcp-auth-001";
const ENV_USER = "test-user-mcp-auth-env";
const ENV_KEY = "env-key-for-mcp-auth-test";

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { id: USER } });
  await prisma.user.create({ data: { id: USER, email: `${USER}@example.com`, passwordHash: "x", name: USER } });
});

afterAll(async () => {
  // Deleting the user cascades its API tokens and clients.
  await prisma.user.deleteMany({ where: { id: USER } });
});

beforeEach(() => {
  process.env.MCP_API_KEY = ENV_KEY;
  process.env.MCP_USER_ID = ENV_USER;
});

afterEach(() => {
  delete process.env.MCP_API_KEY;
  delete process.env.MCP_USER_ID;
});

describe("authenticateMcpRequest", () => {
  it("answers null without a Bearer header, or with an empty token", async () => {
    expect(await authenticateMcpRequest(null, prisma)).toBeNull();
    expect(await authenticateMcpRequest(undefined, prisma)).toBeNull();
    expect(await authenticateMcpRequest("", prisma)).toBeNull();
    expect(await authenticateMcpRequest(`Basic ${ENV_KEY}`, prisma)).toBeNull();
    expect(await authenticateMcpRequest("Bearer", prisma)).toBeNull();
    expect(await authenticateMcpRequest("Bearer    ", prisma)).toBeNull();
  });

  it("lets the server's env key act as MCP_USER_ID with full access and no token", async () => {
    expect(await authenticateMcpRequest(`Bearer ${ENV_KEY}`, prisma)).toEqual({ userId: ENV_USER, tokenId: null, readOnly: false });
    expect(await authenticateMcpRequest(`Bearer   ${ENV_KEY}  `, prisma)).toEqual({ userId: ENV_USER, tokenId: null, readOnly: false });
  });

  it("is a configuration error, not a 401, when the env key matches but MCP_USER_ID is missing", async () => {
    delete process.env.MCP_USER_ID;
    await expect(authenticateMcpRequest(`Bearer ${ENV_KEY}`, prisma)).rejects.toThrow(McpConfigError);
    await expect(authenticateMcpRequest(`Bearer ${ENV_KEY}`, prisma)).rejects.toThrow("MCP_USER_ID not configured");
  });

  it("refuses a key of the same length that differs, and one of another length", async () => {
    expect(await authenticateMcpRequest(`Bearer ${ENV_KEY.slice(0, -1)}x`, prisma)).toBeNull();
    expect(await authenticateMcpRequest(`Bearer ${ENV_KEY}-longer`, prisma)).toBeNull();
    expect(await authenticateMcpRequest("Bearer short", prisma)).toBeNull();
  });

  it("does not take the env-key path when MCP_API_KEY is unset", async () => {
    delete process.env.MCP_API_KEY;
    expect(await authenticateMcpRequest(`Bearer ${ENV_KEY}`, prisma)).toBeNull();
  });

  it("authenticates a personal API token and reports whether it is read-only", async () => {
    const full = await createApiToken(USER, { name: "full" }, prisma);
    const readOnly = await createApiToken(USER, { name: "reader", readOnly: true }, prisma);

    expect(await authenticateMcpRequest(`Bearer ${full.token}`, prisma)).toEqual({ userId: USER, tokenId: full.apiToken.id, readOnly: false });
    expect(await authenticateMcpRequest(`Bearer ${readOnly.token}`, prisma)).toEqual({ userId: USER, tokenId: readOnly.apiToken.id, readOnly: true });
  });

  it("refuses a revoked token and one nobody issued", async () => {
    const { token, apiToken } = await createApiToken(USER, { name: "short-lived" }, prisma);
    await revokeApiToken(USER, apiToken.id, prisma);

    expect(await authenticateMcpRequest(`Bearer ${token}`, prisma)).toBeNull();
    expect(await authenticateMcpRequest("Bearer cap_live_never_issued", prisma)).toBeNull();
  });
});

describe("initializeClientInfo", () => {
  const initialize = (clientInfo: unknown) => ({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo } });

  it("reads the client of an initialize request", () => {
    expect(initializeClientInfo(initialize({ name: "claude-code", version: "2.1.0" }))).toEqual({ name: "claude-code", version: "2.1.0" });
  });

  it("leaves the version out when it is not a string", () => {
    expect(initializeClientInfo(initialize({ name: "cursor" }))).toEqual({ name: "cursor", version: undefined });
    expect(initializeClientInfo(initialize({ name: "cursor", version: 3 }))).toEqual({ name: "cursor", version: undefined });
  });

  it("finds the initialize message inside a batch", () => {
    const batch = [{ jsonrpc: "2.0", method: "notifications/initialized" }, initialize({ name: "inspector", version: "1" })];
    expect(initializeClientInfo(batch)).toEqual({ name: "inspector", version: "1" });
  });

  it("is null for every other request or malformed body", () => {
    expect(initializeClientInfo({ jsonrpc: "2.0", id: 2, method: "tools/list", params: { clientInfo: { name: "x" } } })).toBeNull();
    expect(initializeClientInfo(initialize({ version: "1" }))).toBeNull();
    expect(initializeClientInfo(initialize({ name: 42 }))).toBeNull();
    expect(initializeClientInfo({ method: "initialize" })).toBeNull();
    expect(initializeClientInfo([null, "text", 7, {}])).toBeNull();
    expect(initializeClientInfo(null)).toBeNull();
    expect(initializeClientInfo(undefined)).toBeNull();
    expect(initializeClientInfo("initialize")).toBeNull();
  });
});

describe("recordMcpClient", () => {
  const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "Claude Code", version: "2.1.0" } } };

  it("remembers the client on the token, and updates it on the next initialize", async () => {
    const { apiToken } = await createApiToken(USER, { name: "recorded" }, prisma);
    const principal: McpPrincipal = { userId: USER, tokenId: apiToken.id, readOnly: false };

    await recordMcpClient(principal, initialize, prisma, new Date("2026-09-01T10:00:00.000Z"));
    await recordMcpClient(principal, { ...initialize, params: { clientInfo: { name: "Claude Code", version: "2.2.0" } } }, prisma, new Date("2026-09-02T10:00:00.000Z"));

    const clients = await prisma.apiClient.findMany({ where: { tokenId: apiToken.id } });
    expect(clients).toHaveLength(1);
    expect(clients[0]).toMatchObject({ clientName: "Claude Code", clientVersion: "2.2.0" });
    expect(clients[0].firstSeenAt.toISOString()).toBe("2026-09-01T10:00:00.000Z");
    expect(clients[0].lastUsedAt.toISOString()).toBe("2026-09-02T10:00:00.000Z");
  });

  it("records nothing for a body that is not an initialize", async () => {
    const { apiToken } = await createApiToken(USER, { name: "quiet" }, prisma);
    await recordMcpClient({ userId: USER, tokenId: apiToken.id, readOnly: false }, { jsonrpc: "2.0", id: 2, method: "tools/list" }, prisma);
    expect(await prisma.apiClient.count({ where: { tokenId: apiToken.id } })).toBe(0);
  });

  it("does nothing for the env key, which has no token to attach the client to", async () => {
    const before = await prisma.apiClient.count();
    await recordMcpClient({ userId: ENV_USER, tokenId: null, readOnly: false }, initialize, prisma);
    expect(await prisma.apiClient.count()).toBe(before);
  });
});

describe("isReadOnlyTool", () => {
  it("allows tools annotated readOnlyHint, whatever their name", () => {
    expect(isReadOnlyTool("anything", { annotations: { readOnlyHint: true } })).toBe(true);
    expect(isReadOnlyTool("update_thing", { annotations: { readOnlyHint: true } })).toBe(true);
  });

  it("allows the read verbs in the tool name", () => {
    for (const name of ["list_transactions", "get_settings", "find_orphan_transactions", "search_assets"]) expect(isReadOnlyTool(name)).toBe(true);
  });

  it("treats everything else as a write, including an explicit false hint", () => {
    for (const name of ["create_category", "update_dividend", "delete_budget", "listing", "get", "attach_receipt"]) expect(isReadOnlyTool(name)).toBe(false);
    expect(isReadOnlyTool("create_thing", { annotations: { readOnlyHint: false } })).toBe(false);
    expect(isReadOnlyTool("create_thing", null)).toBe(false);
    expect(isReadOnlyTool("create_thing", { annotations: {} })).toBe(false);
  });
});
