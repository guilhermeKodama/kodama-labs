import path from "node:path";
import { defineProofConfig, proofSuite } from "@repo/proof-video";
import { appDir, proofEnv } from "./env";

const env = proofEnv();

export default defineProofConfig({
  dir: __dirname,
  outDir: env.outDir,
  baseURL: env.baseURL,
  webServer: {
    command: "pnpm proof:server",
    cwd: appDir,
    url: `${env.baseURL}/login`,
    // The port belongs to this checkout, so a server already on it is this checkout's proof server.
    reuseExistingServer: true,
    timeout: 300_000,
  },
  globalSetup: path.join(__dirname, "setup.ts"),
  storageState: env.sessionFile,
  locale: "pt-BR",
  timezoneId: "America/Sao_Paulo",
  // Capital's toasts sit at the bottom, so captions go on top.
  proof: {
    captions: "top",
    hideSelectors: ["nextjs-portal"],
    // Commands run on camera use the proof database too, not the one in .env.
    terminalEnv: env.serverEnv,
    secrets: env.secrets,
  },
  meta: { app: "capital", database: env.databaseName },
  rerun: `pnpm --filter @wallex/capital ${{ flows: "proof:record", once: "proof:once", package: "proof:package" }[proofSuite()]}`,
});
