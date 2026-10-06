import { createHash, randomInt } from "crypto";
import type { ApiClient, ApiToken } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { notFound } from "@capital/server/modules/ledger/lib/errors";

/**
 * Personal API tokens for MCP clients: cap_live_<32 base62 chars>. Only the
 * sha256 of a token is stored; the plaintext is returned once, at creation.
 * `prefix` and `last4` let the UI show it masked (cap_live_••••…3f9a).
 */
export const TOKEN_PREFIX = "cap_live_";
const TOKEN_BODY_LENGTH = 32;
const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
const MASK = "••••••••••••";

/** Scope stored for read-only tokens; an empty scope list is full access (read + write). */
export const READ_SCOPE = "read";

/** lastUsedAt is written at most this often per token (every MCP request authenticates). */
export const LAST_USED_THROTTLE_MS = 60_000;

export function generateToken(): string {
  let body = "";
  for (let i = 0; i < TOKEN_BODY_LENGTH; i++) body += BASE62[randomInt(BASE62.length)];
  return `${TOKEN_PREFIX}${body}`;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function maskToken(t: Pick<ApiToken, "prefix" | "last4">): string {
  return `${t.prefix}${MASK}${t.last4}`;
}

export function isReadOnlyScopes(scopes: readonly string[]): boolean {
  return scopes.includes(READ_SCOPE) && !scopes.includes("write");
}

export function serializeClient(client: ApiClient) {
  return {
    id: client.id,
    clientName: client.clientName,
    clientVersion: client.clientVersion,
    firstSeenAt: client.firstSeenAt.toISOString(),
    lastUsedAt: client.lastUsedAt.toISOString(),
  };
}

export function serializeToken(token: ApiToken & { clients?: ApiClient[] }) {
  return {
    id: token.id,
    name: token.name,
    masked: maskToken(token),
    last4: token.last4,
    readOnly: isReadOnlyScopes(token.scopes),
    createdAt: token.createdAt.toISOString(),
    lastUsedAt: token.lastUsedAt?.toISOString() ?? null,
    clients: (token.clients ?? []).map(serializeClient),
  };
}

export type SerializedApiToken = ReturnType<typeof serializeToken>;

/** Active (unrevoked) tokens, newest first, each with the MCP clients seen on it. */
export async function listApiTokens(userId: string, db: DbClient) {
  const tokens = await db.apiToken.findMany({
    where: { userId, revokedAt: null },
    include: { clients: { orderBy: { lastUsedAt: "desc" } } },
    orderBy: { createdAt: "desc" },
  });
  return tokens.map(serializeToken);
}

/** A new token; `token` is the only time its plaintext exists outside the client. */
export async function createApiToken(userId: string, input: { name?: string | null; readOnly?: boolean }, db: DbClient) {
  const token = generateToken();
  const row = await db.apiToken.create({
    data: {
      userId,
      name: input.name?.trim() || "MCP",
      prefix: TOKEN_PREFIX,
      last4: token.slice(-4),
      tokenHash: hashToken(token),
      scopes: input.readOnly ? [READ_SCOPE] : [],
    },
  });
  return { token, apiToken: serializeToken(row) };
}

/**
 * Rename a token or change what it may do (read-only or read + write). The
 * MCP server is built per request, so the next request already sees it.
 */
export async function updateApiToken(userId: string, id: string, patch: { name?: string; readOnly?: boolean }, db: DbClient) {
  const token = await db.apiToken.findFirst({ where: { id, userId, revokedAt: null } });
  if (!token) throw notFound("API token", "tokens.not_found");
  const updated = await db.apiToken.update({
    where: { id },
    data: {
      ...(patch.name !== undefined && { name: patch.name.trim() || token.name }),
      ...(patch.readOnly !== undefined && { scopes: patch.readOnly ? [READ_SCOPE] : [] }),
    },
    include: { clients: { orderBy: { lastUsedAt: "desc" } } },
  });
  return serializeToken(updated);
}

/** Revoked tokens stop authenticating at once (the MCP route answers 401). */
export async function revokeApiToken(userId: string, id: string, db: DbClient) {
  const { count } = await db.apiToken.updateMany({ where: { id, userId, revokedAt: null }, data: { revokedAt: new Date() } });
  if (!count) throw notFound("API token", "tokens.not_found");
  return { ok: true as const, id };
}

export interface TokenPrincipal {
  userId: string;
  tokenId: string;
  readOnly: boolean;
}

/** The user an unrevoked token belongs to, or null. Marks it used (throttled). */
export async function authenticateApiToken(token: string, db: DbClient, now: Date = new Date()): Promise<TokenPrincipal | null> {
  if (!token.startsWith(TOKEN_PREFIX)) return null;
  const row = await db.apiToken.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!row || row.revokedAt) return null;
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= LAST_USED_THROTTLE_MS) {
    await db.apiToken.update({ where: { id: row.id }, data: { lastUsedAt: now } });
    // Requests after initialize carry no client info: credit the client seen last on this token.
    const latest = await db.apiClient.findFirst({ where: { tokenId: row.id }, orderBy: { lastUsedAt: "desc" } });
    if (latest) await db.apiClient.update({ where: { id: latest.id }, data: { lastUsedAt: now } });
  }
  return { userId: row.userId, tokenId: row.id, readOnly: isReadOnlyScopes(row.scopes) };
}

/** Records the client an MCP initialize names (clientInfo), for the connected-clients table. */
export async function recordApiClient(tokenId: string, info: { name: string; version?: string | null }, db: DbClient, now: Date = new Date()) {
  const clientName = info.name.trim().slice(0, 120);
  if (!clientName) return null;
  const clientVersion = info.version?.toString().slice(0, 60) ?? null;
  return db.apiClient.upsert({
    where: { tokenId_clientName: { tokenId, clientName } },
    create: { tokenId, clientName, clientVersion, firstSeenAt: now, lastUsedAt: now },
    update: { clientVersion, lastUsedAt: now },
  });
}
