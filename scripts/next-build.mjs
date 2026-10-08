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

// Capital's `next build` typecheck needs about 2.7 GB. Node's default
// old-space limit is about 2 GB, which is what OOMs the Docker build.
// Same cap as the Dockerfile RUN, and only on this child: a caller who
// already set a heap size keeps it, and the parent shell is unchanged.
if (!env.NODE_OPTIONS?.includes("max-old-space-size")) {
  env.NODE_OPTIONS = [env.NODE_OPTIONS, "--max-old-space-size=4096"].filter(Boolean).join(" ");
}

const result = spawnSync("pnpm", ["exec", "next", "build"], {
  stdio: "inherit",
  env,
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
