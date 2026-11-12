import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture } from "@/test/ledger-fixtures";
import {
  authenticateApiToken,
  createApiToken,
  generateToken,
  hashToken,
  isReadOnlyScopes,
  LAST_USED_THROTTLE_MS,
  listApiTokens,
  maskToken,
  recordApiClient,
  revokeApiToken,
  TOKEN_PREFIX,
  updateApiToken,
} from "../services/tokens";

/** The token service on its own: what is stored, how names and scopes change, and when a token authenticates. */
const USER = "test-user-tokens-service-a";
const OTHER = "test-user-tokens-service-b";

beforeEach(async () => {
  await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("token strings", () => {
  it("generates cap_live_ tokens of 32 base62 characters, never twice the same", () => {
    const tokens = new Set(Array.from({ length: 20 }, generateToken));
    expect(tokens.size).toBe(20);
    for (const t of tokens) expect(t).toMatch(/^cap_live_[0-9A-Za-z]{32}$/);
  });

  it("hashes with sha256 (hex) and masks all but the last four characters", () => {
    expect(hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(maskToken({ prefix: TOKEN_PREFIX, last4: "3f9a" })).toBe("cap_live_••••••••••••3f9a");
  });

  it("reads a token as read-only only when it has the read scope and not the write scope", () => {
    expect(isReadOnlyScopes(["read"])).toBe(true);
    expect(isReadOnlyScopes([])).toBe(false);
    expect(isReadOnlyScopes(["read", "write"])).toBe(false);
    expect(isReadOnlyScopes(["write"])).toBe(false);
  });
});

describe("creating and listing tokens", () => {
  it("stores only the hash, masks the rest, and names an unnamed token 'MCP'", async () => {
    const { token, apiToken } = await createApiToken(USER, {}, prisma);
    expect(apiToken).toMatchObject({ name: "MCP", readOnly: false, lastUsedAt: null, clients: [], last4: token.slice(-4), masked: `${TOKEN_PREFIX}••••••••••••${token.slice(-4)}` });
    const row = await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } });
    expect(row).toMatchObject({ userId: USER, tokenHash: hashToken(token), scopes: [], prefix: TOKEN_PREFIX });
    expect(JSON.stringify(row)).not.toContain(token);
  });

  it("trims the name, falls back to 'MCP' for a blank one, and makes a read-only token", async () => {
    expect((await createApiToken(USER, { name: "  Cursor  " }, prisma)).apiToken.name).toBe("Cursor");
    expect((await createApiToken(USER, { name: "   " }, prisma)).apiToken.name).toBe("MCP");
    expect((await createApiToken(USER, { name: null, readOnly: true }, prisma)).apiToken).toMatchObject({ name: "MCP", readOnly: true });
  });

  it("lists the user's unrevoked tokens newest first, with their clients, and no one else's", async () => {
    const first = await createApiToken(USER, { name: "primeiro" }, prisma);
    const second = await createApiToken(USER, { name: "segundo" }, prisma);
    const revoked = await createApiToken(USER, { name: "revogado" }, prisma);
    await createApiToken(OTHER, { name: "de outro" }, prisma);
    await revokeApiToken(USER, revoked.apiToken.id, prisma);
    await recordApiClient(first.apiToken.id, { name: "Cursor", version: "1.0" }, prisma, new Date("2026-09-01T10:00:00Z"));
    await recordApiClient(first.apiToken.id, { name: "Claude", version: "2.0" }, prisma, new Date("2026-09-02T10:00:00Z"));

    const list = await listApiTokens(USER, prisma);
    expect(list.map((t) => t.name)).toEqual(["segundo", "primeiro"]);
    expect(list[0].id).toBe(second.apiToken.id);
    expect(list[1].clients.map((c) => [c.clientName, c.clientVersion, c.lastUsedAt])).toEqual([
      ["Claude", "2.0", "2026-09-02T10:00:00.000Z"],
      ["Cursor", "1.0", "2026-09-01T10:00:00.000Z"],
    ]);
  });
});

describe("renaming and re-scoping a token", () => {
  it("renames it (trimmed), keeping the name when the new one is blank, and switches between read-only and full access", async () => {
    const { apiToken } = await createApiToken(USER, { name: "Cursor" }, prisma);
    expect((await updateApiToken(USER, apiToken.id, { name: "  Claude  " }, prisma)).name).toBe("Claude");
    expect((await updateApiToken(USER, apiToken.id, { name: "   " }, prisma)).name).toBe("Claude");
    expect(await updateApiToken(USER, apiToken.id, { readOnly: true }, prisma)).toMatchObject({ name: "Claude", readOnly: true });
    expect((await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } })).scopes).toEqual(["read"]);
    expect((await updateApiToken(USER, apiToken.id, { readOnly: false }, prisma)).readOnly).toBe(false);
    // An empty patch changes nothing.
    expect(await updateApiToken(USER, apiToken.id, {}, prisma)).toMatchObject({ name: "Claude", readOnly: false });
  });

  it("answers 404 for a token that is not the user's or is revoked", async () => {
    const mine = await createApiToken(USER, {}, prisma);
    const theirs = await createApiToken(OTHER, {}, prisma);
    await expect(updateApiToken(USER, theirs.apiToken.id, { name: "x" }, prisma)).rejects.toMatchObject({ status: 404, code: "tokens.not_found" });
    await expect(updateApiToken(USER, "nao-existe", { name: "x" }, prisma)).rejects.toMatchObject({ code: "tokens.not_found" });
    await revokeApiToken(USER, mine.apiToken.id, prisma);
    await expect(updateApiToken(USER, mine.apiToken.id, { name: "x" }, prisma)).rejects.toMatchObject({ code: "tokens.not_found" });
  });
});

describe("revoking a token", () => {
  it("revokes once; the token stops authenticating and a second revoke or another user's token is a 404", async () => {
    const { token, apiToken } = await createApiToken(USER, {}, prisma);
    expect(await revokeApiToken(USER, apiToken.id, prisma)).toEqual({ ok: true, id: apiToken.id });
    expect((await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } })).revokedAt).not.toBeNull();
    expect(await authenticateApiToken(token, prisma)).toBeNull();
    await expect(revokeApiToken(USER, apiToken.id, prisma)).rejects.toMatchObject({ status: 404, code: "tokens.not_found" });
    const theirs = await createApiToken(OTHER, {}, prisma);
    await expect(revokeApiToken(USER, theirs.apiToken.id, prisma)).rejects.toMatchObject({ code: "tokens.not_found" });
  });
});

describe("authenticateApiToken", () => {
  it("answers null for a string without the prefix and for an unknown token", async () => {
    expect(await authenticateApiToken("Bearer-nope", prisma)).toBeNull();
    expect(await authenticateApiToken(generateToken(), prisma)).toBeNull();
  });

  it("answers the user, the token and whether it is read-only", async () => {
    const full = await createApiToken(USER, {}, prisma);
    const readOnly = await createApiToken(USER, { readOnly: true }, prisma);
    expect(await authenticateApiToken(full.token, prisma)).toEqual({ userId: USER, tokenId: full.apiToken.id, readOnly: false });
    expect(await authenticateApiToken(readOnly.token, prisma)).toEqual({ userId: USER, tokenId: readOnly.apiToken.id, readOnly: true });
  });

  it("marks the token used, then not again within the throttle window, and credits the client seen last", async () => {
    const { token, apiToken } = await createApiToken(USER, {}, prisma);
    const t0 = new Date("2026-09-10T10:00:00Z");
    await recordApiClient(apiToken.id, { name: "Cursor" }, prisma, new Date("2026-09-01T00:00:00Z"));
    await recordApiClient(apiToken.id, { name: "Claude" }, prisma, new Date("2026-09-05T00:00:00Z"));

    await authenticateApiToken(token, prisma, t0);
    const used = async () => (await prisma.apiToken.findUniqueOrThrow({ where: { id: apiToken.id } })).lastUsedAt;
    expect(await used()).toEqual(t0);
    const clientTimes = async () => Object.fromEntries((await prisma.apiClient.findMany({ where: { tokenId: apiToken.id } })).map((c) => [c.clientName, c.lastUsedAt.toISOString()]));
    expect(await clientTimes()).toEqual({ Cursor: "2026-09-01T00:00:00.000Z", Claude: t0.toISOString() });

    // Inside the window: nothing is written.
    await authenticateApiToken(token, prisma, new Date(t0.getTime() + LAST_USED_THROTTLE_MS - 1));
    expect(await used()).toEqual(t0);
    // At the window's edge: written again.
    const t1 = new Date(t0.getTime() + LAST_USED_THROTTLE_MS);
    await authenticateApiToken(token, prisma, t1);
    expect(await used()).toEqual(t1);
  });

  it("marks a token with no client used without crediting anyone", async () => {
    const { token, apiToken } = await createApiToken(USER, {}, prisma);
    const now = new Date("2026-09-10T10:00:00Z");
    expect(await authenticateApiToken(token, prisma, now)).toMatchObject({ tokenId: apiToken.id });
    expect(await prisma.apiClient.count({ where: { tokenId: apiToken.id } })).toBe(0);
  });
});

describe("recordApiClient", () => {
  it("ignores a client with a blank name, cuts long names and versions, and updates the one it already knows", async () => {
    const { apiToken } = await createApiToken(USER, {}, prisma);
    expect(await recordApiClient(apiToken.id, { name: "   " }, prisma)).toBeNull();
    expect(await prisma.apiClient.count({ where: { tokenId: apiToken.id } })).toBe(0);

    const long = await recordApiClient(apiToken.id, { name: ` ${"n".repeat(200)} `, version: "v".repeat(100) }, prisma, new Date("2026-09-01T00:00:00Z"));
    expect(long?.clientName).toHaveLength(120);
    expect(long?.clientVersion).toHaveLength(60);

    const first = await recordApiClient(apiToken.id, { name: "Cursor", version: "1.0" }, prisma, new Date("2026-09-01T00:00:00Z"));
    const again = await recordApiClient(apiToken.id, { name: "Cursor", version: "1.1" }, prisma, new Date("2026-09-03T00:00:00Z"));
    expect(again?.id).toBe(first?.id);
    expect(again).toMatchObject({ clientVersion: "1.1" });
    expect(again?.firstSeenAt.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(again?.lastUsedAt.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    expect((await recordApiClient(apiToken.id, { name: "Zed" }, prisma))?.clientVersion).toBeNull();
  });
});
