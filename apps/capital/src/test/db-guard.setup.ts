import { assertNonProductionDatabase, databaseNameFromUrl } from "@capital/server/lib/db-guard";

/**
 * Runs before any test file is imported. A second line of defence behind
 * the one in prisma.ts: this fails the whole run immediately and prints
 * the target database, so a misconfigured DATABASE_URL can never reach a
 * single test body - not even one that never imports the Prisma client.
 *
 * NODE_ENV is "test" under vitest, so the production carve-out in
 * assertNonProductionDatabase cannot apply here.
 */
const url = process.env.DATABASE_URL;

if (!url) {
  throw new Error(
    "[db-guard] DATABASE_URL is unset for the test run.\n" +
      "vitest.config.ts loads apps/capital/.env - create it first (see .env.example,\n" +
      "or the 1Password Environment kodama-labs-capital-dev described in CLAUDE.md)."
  );
}

assertNonProductionDatabase(url, "vitest");

if (!process.env.VITEST_QUIET_DB_GUARD) {
  console.log(`[db-guard] tests running against database "${databaseNameFromUrl(url)}"`);
}
