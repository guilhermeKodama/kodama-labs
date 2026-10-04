#!/usr/bin/env node
/**
 * Run `next build` without a real database.
 *
 * Next imports modules that construct PrismaClient and validate env at
 * build time. That only needs a parseable URL, not a server. Callers that
 * already have DATABASE_URL / DIRECT_URL (Docker, a developer .env) keep
 * them. Migrations are not part of this step.
 */
import { spawnSync } from "node:child_process";

const placeholder = "postgresql://placeholder:placeholder@placeholder:5432/placeholder";
const env = { ...process.env };
if (!env.DATABASE_URL) env.DATABASE_URL = placeholder;
if (!env.DIRECT_URL) env.DIRECT_URL = placeholder;

const result = spawnSync("pnpm", ["exec", "next", "build"], {
  stdio: "inherit",
  env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
