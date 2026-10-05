import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { connectKuma, provisionMonitors } from "./kuma.js";
import { buildMonitors } from "./spec.js";

function schedulesDir(): string {
  if (process.env.CRON_SCHEDULES_DIR?.trim()) return process.env.CRON_SCHEDULES_DIR.trim();
  return join(dirname(fileURLToPath(import.meta.url)), "../../cronjobs/schedules");
}

async function main(): Promise<void> {
  const monitors = buildMonitors({
    composeProject: process.env.COMPOSE_PROJECT_NAME,
    postgresUser: process.env.POSTGRES_USER,
    postgresPassword: process.env.POSTGRES_PASSWORD,
    extraPublicHosts: process.env.EXTRA_PUBLIC_HOSTS,
    ollamaHealthUrl: process.env.OLLAMA_HEALTH_URL,
    whisperHealthUrl: process.env.WHISPER_HEALTH_URL,
    schedulesDir: schedulesDir(),
  });
  const session = await connectKuma();
  try {
    const dockerOk = await provisionMonitors(session, monitors);
    if (!dockerOk) process.exitCode = 1;
  } finally {
    session.socket.close();
  }
}

main().catch((error: unknown) => {
  console.error("[provision]", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
