import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { chromium, request } from "@playwright/test";
import { appDir, prepareDatabase, proofEnv } from "./env";

/**
 * Opened once before the flows. In dev mode the first visit compiles the
 * page, and the app creates each user's default views on first load;
 * neither belongs on camera.
 */
const WARM_UP = ["/transactions", "/transactions/budgets", "/investments", "/investments/contributions", "/settings"];

/** Runs once per proof run: fresh demo data, a signed-in session, warm pages. */
export default async function setup(): Promise<() => void> {
  const env = proofEnv();
  prepareDatabase(env);

  // A new password every run. It reaches the seed and the login flow
  // through the environment and is never written anywhere.
  const password = randomBytes(24).toString("base64url");
  try {
    execFileSync("pnpm", ["exec", "tsx", "prisma/seed-demo.ts"], {
      cwd: appDir,
      env: { ...process.env, ...env.serverEnv, DEMO_USER_EMAIL: env.demoEmail, DEMO_USER_PASSWORD: password },
      stdio: ["ignore", "pipe", "pipe"],
      encoding: "utf8",
    });
  } catch (error) {
    const output = (error as { stdout?: string; stderr?: string }).stderr || (error as { stdout?: string }).stdout || String(error);
    throw new Error(`[proof] The demo seed failed:\n${output.split(password).join("***")}`);
  }
  process.env.PROOF_DEMO_EMAIL = env.demoEmail;
  process.env.PROOF_DEMO_PASSWORD = password;

  fs.mkdirSync(env.outDir, { recursive: true });
  const api = await request.newContext({ baseURL: env.baseURL });
  const login = await api.post("/api/v2/auth/login", { data: { email: env.demoEmail, password } });
  if (!login.ok()) throw new Error(`[proof] Signing in as the demo user failed with HTTP ${login.status()}.`);
  await api.storageState({ path: env.sessionFile });
  await api.dispose();

  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({
      baseURL: env.baseURL,
      storageState: env.sessionFile,
      serviceWorkers: "block",
      locale: "pt-BR",
      timezoneId: "America/Sao_Paulo",
    });
    const page = await context.newPage();
    for (const route of WARM_UP) {
      await page.goto(route, { timeout: 180_000 });
      await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => undefined);
    }
  } catch (error) {
    // No flows will run, so the teardown below never will either.
    fs.rmSync(env.sessionFile, { force: true });
    throw error;
  } finally {
    await browser.close();
  }

  return () => fs.rmSync(env.sessionFile, { force: true });
}
