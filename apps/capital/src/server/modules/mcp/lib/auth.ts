import crypto from "crypto";
import type { DbClient } from "@capital/server/lib/prisma";
import { authenticateApiToken, recordApiClient } from "@capital/server/modules/api-tokens/services/tokens";

/**
 * MCP authentication: `Authorization: Bearer <token>`, where the token is
 * either the server's MCP_API_KEY (acting as MCP_USER_ID, full access; the
 * original single-user setup, kept as a fallback) or a personal API token
 * created in Ajustes › Integrações e API (cap_live_…, looked up by hash).
 */
export interface McpPrincipal {
  userId: string;
  /** The ApiToken used; null for the env key. */
  tokenId: string | null;
  /** Read-only tokens only get the read tools (see isReadOnlyTool). */
  readOnly: boolean;
}

/** Thrown when MCP_API_KEY matches but MCP_USER_ID is missing: a server misconfiguration (500), not a bad token. */
export class McpConfigError extends Error {}

function timingSafeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/** The principal an Authorization header names, or null (the route answers 401). */
export async function authenticateMcpRequest(authorization: string | null | undefined, db: DbClient, now: Date = new Date()): Promise<McpPrincipal | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const token = authorization.slice(7).trim();
  if (!token) return null;
  const envKey = process.env.MCP_API_KEY;
  if (envKey && timingSafeEqual(token, envKey)) {
    const userId = process.env.MCP_USER_ID;
    if (!userId) throw new McpConfigError("MCP_USER_ID not configured");
    return { userId, tokenId: null, readOnly: false };
  }
  return authenticateApiToken(token, db, now);
}

/**
 * clientInfo of an MCP initialize request (single message or batch), or
 * null for any other request. Only initialize carries it in the stateless
 * transport.
 */
export function initializeClientInfo(body: unknown): { name: string; version?: string } | null {
  const messages = Array.isArray(body) ? body : [body];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const { method, params } = message as { method?: unknown; params?: { clientInfo?: { name?: unknown; version?: unknown } } };
    const info = params?.clientInfo;
    if (method === "initialize" && info && typeof info.name === "string") {
      return { name: info.name, version: typeof info.version === "string" ? info.version : undefined };
    }
  }
  return null;
}

/** Remembers the client on the token (env-key requests have no token to attach it to). */
export async function recordMcpClient(principal: McpPrincipal, body: unknown, db: DbClient, now: Date = new Date()) {
  if (!principal.tokenId) return;
  const info = initializeClientInfo(body);
  if (info) await recordApiClient(principal.tokenId, info, db, now);
}

/**
 * Tools a read-only token may call: those annotated readOnlyHint, and the
 * read verbs the tool names use (list_, get_, find_, search_). Anything else
 * is treated as a write and is not registered for read-only tokens.
 */
export function isReadOnlyTool(name: string, config?: { annotations?: { readOnlyHint?: boolean } } | null): boolean {
  return config?.annotations?.readOnlyHint === true || /^(list|get|find|search)_/.test(name);
}
