/**
 * `pnpm proof:server`: Capital for proof runs. It runs on this checkout's
 * own port against this checkout's own database, in dev mode so the
 * database guard stays on. Playwright starts it by itself; start it by
 * hand to keep it up while several agents record against it.
 */
import { spawn } from "node:child_process";
import { appDir, prepareDatabase, proofEnv } from "./env";

const env = proofEnv();
console.log(`[proof] ${env.baseURL} on database ${env.databaseName}`);
prepareDatabase(env);

const server = spawn("pnpm", ["exec", "next", "dev", "--port", String(env.port)], {
  cwd: appDir,
  env: { ...process.env, ...env.serverEnv },
  stdio: "inherit",
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => server.kill(signal));
}
server.on("exit", (code) => process.exit(code ?? 0));
