#!/usr/bin/env node
/**
 * Guard for the Prisma CLI scripts (db:migrate, db:push, db:seed,
 * db:reset). Those talk to Postgres directly and never import
 * src/server/lib/prisma.ts, so the runtime guard cannot see them - and
 * `prisma migrate reset --force` against production would be
 * unrecoverable.
 *
 * Deliberately NOT wired to `build`, which runs `prisma migrate deploy`
 * and must keep working against production on deploy.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  process.loadEnvFile(path.join(appDir, ".env"));
} catch {
  // No .env - fall through to the unset check below.
}

const url = process.env.DATABASE_URL;
const command = process.argv.slice(2).join(" ") || "this command";

if (!url) {
  console.error(
    `\n[db-guard] DATABASE_URL is unset - refusing to run ${command}.\n` +
      `Create apps/capital/.env first (see .env.example, or fetch the 1Password\n` +
      `Environment kodama-labs-capital-dev as described in the repo CLAUDE.md).\n`
  );
  process.exit(1);
}

let name = null;
try {
  name = new URL(url).pathname.replace(/^\//, "").split("?")[0] || null;
} catch {
  name = null;
}

if (process.env.CAPITAL_ALLOW_PROD_DB === "1") {
  console.warn(`[db-guard] CAPITAL_ALLOW_PROD_DB=1 - allowing ${command} against "${name}".`);
  process.exit(0);
}

if (!name || !(name.endsWith("_dev") || name.endsWith("_test"))) {
  console.error(
    `\n[db-guard] Refusing to run ${command} against database "${name ?? "<unparseable>"}".\n\n` +
      `Schema commands may only target a database ending in _dev or _test.\n` +
      `Production is for end users only - never for tests, scripts or AI agents.\n\n` +
      `Point DATABASE_URL at capital_dev, or set CAPITAL_ALLOW_PROD_DB=1 for this one command\n` +
      `if you truly mean it.\n`
  );
  process.exit(1);
}

console.log(`[db-guard] ok - "${name}"`);
