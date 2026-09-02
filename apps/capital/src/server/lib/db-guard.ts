/**
 * Refuse to touch the production database from anywhere that is not the
 * production runtime.
 *
 * The rule is a positive allowlist, not a blocklist of known prod names:
 * outside NODE_ENV=production the database must be named `*_dev` or
 * `*_test`. A blocklist would only have caught the names we thought of;
 * this catches `capital`, `capital_prod`, a copied Neon URL, anything.
 *
 * This exists because the separation used to be advisory. env.ts carried
 * `.default("postgresql://root:root@localhost:5433/capital")`, so any
 * context that did not load a .env - vitest being the dangerous one,
 * since it loads none by default - silently fell through to production
 * and wrote there without a single warning.
 */

const ALLOWED_NON_PRODUCTION_SUFFIXES = ["_dev", "_test"];

/** Explicit, deliberate opt-out for a one-off read against prod. */
const OVERRIDE_ENV_VAR = "CAPITAL_ALLOW_PROD_DB";

export function databaseNameFromUrl(url: string): string | null {
  try {
    // pathname is "/capital_dev"; strip the slash. Falls back to null for
    // anything unparseable rather than guessing.
    const name = new URL(url).pathname.replace(/^\//, "").split("?")[0];
    return name || null;
  } catch {
    return null;
  }
}

export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * @param context - what is connecting, quoted back in the error so the
 *   reader knows which entry point to fix (e.g. "prisma client", "vitest").
 */
export function assertNonProductionDatabase(url: string, context: string): void {
  if (isProductionRuntime()) return;
  if (process.env[OVERRIDE_ENV_VAR] === "1") return;

  const name = databaseNameFromUrl(url);
  if (name && ALLOWED_NON_PRODUCTION_SUFFIXES.some((s) => name.endsWith(s))) return;

  throw new Error(
    [
      `[db-guard] Refusing to connect: ${context} resolved the database "${name ?? "<unparseable>"}",`,
      `which is not a development or test database.`,
      ``,
      `Outside NODE_ENV=production the database name must end in ${ALLOWED_NON_PRODUCTION_SUFFIXES.join(" or ")}.`,
      `Production is for end users only - never for tests, scripts or AI agents.`,
      ``,
      `Fix: point DATABASE_URL at capital_dev (see apps/capital/.env.example, or fetch the`,
      `1Password Environment kodama-labs-capital-dev as described in the repo CLAUDE.md).`,
      `If you genuinely need a one-off read against production, set ${OVERRIDE_ENV_VAR}=1 for that command only.`,
    ].join("\n")
  );
}
