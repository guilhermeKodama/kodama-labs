import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/env";
import { prisma } from "@pipeline/server/lib/prisma";

const TIMESTAMP_SKEW_MS = 5 * 60 * 1000;

// x-kodama-signature: sha256=<hex of HMAC-SHA256(secret, `${timestamp}.${rawBody}`)>
export function verifySignature(
  rawBody: string,
  timestamp: string | undefined,
  signature: string | undefined,
): { valid: boolean; reason?: string } {
  const secret = env.WEBHOOK_HMAC_SECRET;
  if (!secret) {
    // Local dev without a secret accepts everything; production without a
    // secret rejects everything (fail closed).
    return env.NODE_ENV === "production"
      ? { valid: false, reason: "secret_not_configured" }
      : { valid: true };
  }
  if (!timestamp || !signature) return { valid: false, reason: "missing_headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { valid: false, reason: "bad_timestamp" };
  if (Math.abs(Date.now() - ts) > TIMESTAMP_SKEW_MS) {
    return { valid: false, reason: "timestamp_skew" };
  }

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
  const provided = signature.replace(/^sha256=/, "");

  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) return { valid: false, reason: "bad_signature" };
  return timingSafeEqual(a, b)
    ? { valid: true }
    : { valid: false, reason: "bad_signature" };
}

// Origin allowlist derived from synced ideas' landing_url — a new idea is
// authorized automatically on its next sync. Only consulted for requests that
// carry a browser Origin/Referer; the legit LP forward is server-to-server
// and sends neither.
let allowlistCache: { origins: Set<string>; fetchedAt: number } | null = null;
const ALLOWLIST_TTL_MS = 60_000;

export async function isOriginAllowed(
  origin: string | undefined,
  referer: string | undefined,
): Promise<boolean> {
  const candidate = origin ?? referer;
  if (!candidate) return true; // server-to-server

  if (!allowlistCache || Date.now() - allowlistCache.fetchedAt > ALLOWLIST_TTL_MS) {
    const ideas = await prisma.idea.findMany({
      where: { landingUrl: { not: null } },
      select: { landingUrl: true },
    });
    const origins = new Set<string>();
    for (const idea of ideas) {
      try {
        origins.add(new URL(idea.landingUrl!).origin);
      } catch {
        // unparseable landing_url — skip
      }
    }
    if (env.NODE_ENV !== "production") origins.add("http://localhost:3100");
    allowlistCache = { origins, fetchedAt: Date.now() };
  }

  try {
    return allowlistCache.origins.has(new URL(candidate).origin);
  } catch {
    return false;
  }
}

// Minimal in-memory rate limit — enough at validation scale; resets on deploy.
const buckets = new Map<string, { count: number; windowStart: number }>();
const RATE_WINDOW_MS = 60_000;
const RATE_LIMIT = 30;

export function rateLimited(key: string): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > RATE_WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    return false;
  }
  bucket.count += 1;
  return bucket.count > RATE_LIMIT;
}
