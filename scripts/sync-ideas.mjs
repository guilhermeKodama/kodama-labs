#!/usr/bin/env node
// Syncs ideas/*/idea.yaml to the pipeline dashboard (full snapshot).
//
//   pnpm sync:ideas                       → POST to http://localhost:3004
//   pnpm sync:ideas --dry-run             → parse + print payload, no network
//   PIPELINE_URL=https://... SYNC_SECRET=... pnpm sync:ideas   → manual prod sync
//
// Semantic validation lives in the dashboard (apps/pipeline); this script only
// checks YAML syntax and placeholders. A 422 response is printed as GitHub
// annotations pointing at the offending idea.yaml.
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const IDEAS_DIR = join(REPO_ROOT, "ideas");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

async function readEnvLocal(key) {
  for (const file of ["apps/pipeline/.env.local", "apps/pipeline/.env"]) {
    try {
      const content = await readFile(join(REPO_ROOT, file), "utf8");
      const line = content
        .split("\n")
        .find((l) => l.trim().startsWith(`${key}=`));
      if (line) return line.slice(line.indexOf("=") + 1).trim().replace(/^["']|["']$/g, "");
    } catch {
      // file missing — keep looking
    }
  }
  return undefined;
}

const entries = await readdir(IDEAS_DIR, { withFileTypes: true });
const dirs = entries
  .filter((d) => d.isDirectory() && !d.name.startsWith("_"))
  .map((d) => d.name)
  .sort();

const ideas = [];
const skipped = [];
const errors = [];

for (const slug of dirs) {
  const file = join(IDEAS_DIR, slug, "idea.yaml");
  const raw = await readFile(file, "utf8").catch(() => null);
  if (raw === null) {
    skipped.push(slug);
    continue;
  }
  if (raw.includes("{{IDEA_")) {
    errors.push({ slug, message: "unresolved {{IDEA_*}} placeholder — fill in idea.yaml" });
    continue;
  }
  try {
    const config = yaml.load(raw, { schema: yaml.JSON_SCHEMA });
    ideas.push({ slug, config });
  } catch (err) {
    errors.push({ slug, message: `invalid YAML: ${err.message?.split("\n")[0] ?? err}` });
  }
}

function annotate(slug, message) {
  // GitHub inline annotation in CI; plain stderr locally
  console.error(`::error file=ideas/${slug}/idea.yaml::${message}`);
}

if (errors.length) {
  for (const e of errors) annotate(e.slug, e.message);
  process.exit(1);
}
for (const slug of skipped) {
  console.warn(`⚠ ideas/${slug}: no idea.yaml — not tracked by the dashboard`);
}

const payload = {
  source: {
    repo: "kodama-labs",
    commitSha: process.env.GITHUB_SHA ?? null,
    ref: process.env.GITHUB_REF ?? null,
  },
  ideas,
  skipped,
};

if (dryRun) {
  console.log(JSON.stringify(payload, null, 2));
  process.exit(0);
}

const baseUrl = process.env.PIPELINE_URL ?? "http://localhost:3004";
const secret = process.env.SYNC_SECRET ?? (await readEnvLocal("SYNC_SECRET"));
if (!secret) {
  console.error("SYNC_SECRET not set (env or apps/pipeline/.env.local)");
  process.exit(1);
}

const res = await fetch(`${baseUrl}/api/sync/ideas`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${secret}`,
  },
  body: JSON.stringify(payload),
});

const body = await res.json().catch(() => ({}));

if (res.status === 422 && body?.error?.issues) {
  for (const issue of body.error.issues) {
    // path: ["ideas", <index>, "config", ...] → map back to the file
    const [root, index, ...rest] = issue.path ?? [];
    const slug =
      root === "ideas" && typeof index === "number" ? ideas[index]?.slug : null;
    const where = rest.length ? rest.join(".") : "(payload)";
    annotate(slug ?? "(unknown)", `${where}: ${issue.message}`);
  }
  process.exit(1);
}

if (!res.ok) {
  console.error(`sync failed: ${res.status}`, JSON.stringify(body));
  process.exit(1);
}

for (const r of body.results) {
  console.log(`  ${r.action.padEnd(10)} ${r.slug}`);
}
console.log(`✓ synced ${ideas.length} idea(s), ${skipped.length} skipped`);
