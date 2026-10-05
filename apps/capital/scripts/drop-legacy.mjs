#!/usr/bin/env node
/**
 * `pnpm db:drop-legacy` - runs scripts/drop-legacy.sql against DATABASE_URL.
 * Irreversible, so it is not a migration and asks for an explicit
 * confirmation: CONFIRM_DROP_LEGACY must equal the target database name.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
try {
  process.loadEnvFile(path.join(appDir, ".env"));
} catch {
  // No .env - DATABASE_URL must come from the environment.
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("[drop-legacy] DATABASE_URL is unset.");
  process.exit(1);
}
const database = new URL(url).pathname.replace(/^\//, "");
if (process.env.CONFIRM_DROP_LEGACY !== database) {
  console.error(
    `[drop-legacy] This permanently drops the "legacy" schema of database "${database}".\n` +
      `Take a pg_dump first, then re-run with CONFIRM_DROP_LEGACY=${database}.`
  );
  process.exit(1);
}

execFileSync("npx", ["prisma", "db", "execute", "--file", "scripts/drop-legacy.sql", "--schema", "prisma/schema.prisma"], {
  cwd: appDir,
  stdio: "inherit",
});
console.log(`[drop-legacy] Dropped schema "legacy" from ${database}.`);
