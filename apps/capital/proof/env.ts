import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import { assertProofDatabase, checkoutPort, checkoutSlug, proofDatabaseUrl } from "@repo/proof-video/environment";
import { assertNonProductionDatabase, databaseNameFromUrl } from "../src/server/lib/db-guard";

export const appDir = path.resolve(__dirname, "..");

export interface ProofEnv {
  port: number;
  baseURL: string;
  databaseName: string;
  /** Results of this run. One folder per slot when agents record in parallel. */
  outDir: string;
  sessionFile: string;
  demoEmail: string;
  /** Strings a recorded terminal must never show. */
  secrets: string[];
  /** Environment of the proof server and of every script that touches its database. */
  serverEnv: Record<string, string>;
}

/**
 * Everything a proof run of Capital needs, derived from this checkout:
 * its own port, its own database (`capital_proof_<checkout>_dev`) and no
 * outside services. `apps/capital/.env` is read only for the local
 * database server's address and login.
 */
export function proofEnv(): ProofEnv {
  const envFile = path.join(appDir, ".env");
  if (!fs.existsSync(envFile)) {
    throw new Error("[proof] apps/capital/.env is missing. See the root CLAUDE.md, 'Local secrets for a new worktree'.");
  }
  const dotenv = parseEnv(fs.readFileSync(envFile, "utf8"));
  const source = dotenv.DATABASE_URL;
  if (!source) throw new Error("[proof] apps/capital/.env has no DATABASE_URL.");

  const databaseUrl = proofDatabaseUrl(source, "capital", checkoutSlug(appDir));
  // A server already on this port is reused. If it is not this checkout's
  // proof server (a PROOF_PORT pointed at a dev server, or two checkouts
  // landing on one port), setup stops at sign-in: the demo user's
  // password exists only in this checkout's proof database.
  const port = Number(process.env.PROOF_PORT) || checkoutPort(appDir);
  const baseURL = `http://localhost:${port}`;
  // A slot gives one of several agents recording at once its own demo user and results folder.
  const slot = (process.env.PROOF_SLOT ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const outDir = path.join(__dirname, "out", ...(slot ? [`slot-${slot}`] : []));

  return {
    port,
    baseURL,
    databaseName: databaseNameFromUrl(databaseUrl) ?? "",
    outDir,
    sessionFile: path.join(outDir, "session.json"),
    demoEmail: `proof${slot ? `-${slot}` : ""}@capital.test`,
    // Every longer value of .env: a command run on camera loads that file and may print from it.
    secrets: Object.values(dotenv).filter((value): value is string => typeof value === "string" && value.length >= 8),
    serverEnv: {
      DATABASE_URL: databaseUrl,
      DIRECT_URL: databaseUrl,
      // A caller's NODE_ENV=production would switch the app's database guard off.
      NODE_ENV: "development",
      NEXT_PUBLIC_APP_URL: baseURL,
      CAPITAL_BLOB_DIR: path.join(__dirname, "out", "blob"),
      // Empty wins over .env: no assistant, no AI suggestions, no paid quote API, no push.
      ANTHROPIC_API_KEY: "",
      BRAPI_TOKEN: "",
      APP_URL: "",
      VAPID_PRIVATE_KEY: "",
      NEXT_PUBLIC_VAPID_PUBLIC_KEY: "",
      MCP_API_KEY: "",
      MCP_USER_ID: "",
      // The guard's escape hatch must not leak in from the caller's shell.
      CAPITAL_ALLOW_PROD_DB: "",
    },
  };
}

/** Creates the proof database if needed and brings it to this branch's migrations. */
export function prepareDatabase(env: ProofEnv): void {
  const url = env.serverEnv.DATABASE_URL ?? "";
  assertProofDatabase(url, "capital");
  assertNonProductionDatabase(url, "proof");
  try {
    execFileSync("pnpm", ["exec", "prisma", "migrate", "deploy"], {
      cwd: appDir,
      env: { ...process.env, ...env.serverEnv },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    const output = (error as { stderr?: string }).stderr || (error as { stdout?: string }).stdout || String(error);
    throw new Error(`[proof] Migrating ${env.databaseName} failed:\n${output}`);
  }
}
