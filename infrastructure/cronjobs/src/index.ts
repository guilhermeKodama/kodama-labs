/**
 * Local Cron Runner
 *
 * Reads vercel.json from apps and schedules cron jobs locally using node-cron.
 * This simulates Vercel's cron behavior in development.
 */

import "dotenv/config";
import cron from "node-cron";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

interface VercelCron {
  path: string;
  schedule: string;
}

interface VercelConfig {
  crons?: VercelCron[];
}

interface AppConfig {
  name: string;
  baseUrl: string;
  vercelJsonPath: string;
  cronSecret?: string;
}

// Configuration for apps with cron jobs
const APPS: AppConfig[] = [
  {
    name: "capital",
    baseUrl: "http://localhost:3000",
    vercelJsonPath: join(__dirname, "../../../apps/capital/vercel.json"),
    cronSecret: process.env.CRON_SECRET,
  },
];

/**
 * Reads and parses vercel.json
 */
function readVercelConfig(path: string): VercelConfig {
  try {
    if (!existsSync(path)) {
      console.warn(`[Cron] vercel.json not found at ${path}`);
      return {};
    }
    const content = readFileSync(path, "utf-8");
    return JSON.parse(content) as VercelConfig;
  } catch (error) {
    console.error(`[Cron] Error reading vercel.json:`, error);
    return {};
  }
}

/**
 * Calls a cron endpoint
 */
async function triggerCronEndpoint(
  app: AppConfig,
  path: string
): Promise<void> {
  const url = `${app.baseUrl}${path}`;
  const timestamp = new Date().toISOString();

  console.log(`[Cron] [${timestamp}] Triggering ${app.name}${path}...`);

  try {
    const headers: Record<string, string> = {};
    if (app.cronSecret) {
      headers["Authorization"] = `Bearer ${app.cronSecret}`;
    }

    const response = await fetch(url, {
      method: "GET",
      headers,
    });

    if (response.ok) {
      const result = await response.json();
      console.log(`[Cron] [${timestamp}] ${app.name}${path} completed:`, result);
    } else {
      console.error(
        `[Cron] [${timestamp}] ${app.name}${path} failed with status ${response.status}`
      );
    }
  } catch (error) {
    // App might not be running yet
    if ((error as Error).cause?.toString().includes("ECONNREFUSED")) {
      console.warn(
        `[Cron] [${timestamp}] ${app.name} not running at ${app.baseUrl}`
      );
    } else {
      console.error(`[Cron] [${timestamp}] ${app.name}${path} error:`, error);
    }
  }
}

/**
 * Schedules cron jobs for an app
 */
function scheduleAppCrons(app: AppConfig): number {
  const config = readVercelConfig(app.vercelJsonPath);

  if (!config.crons || config.crons.length === 0) {
    console.log(`[Cron] No crons found for ${app.name}`);
    return 0;
  }

  let scheduled = 0;

  for (const { path, schedule } of config.crons) {
    if (!cron.validate(schedule)) {
      console.error(
        `[Cron] Invalid schedule "${schedule}" for ${app.name}${path}`
      );
      continue;
    }

    cron.schedule(schedule, () => {
      triggerCronEndpoint(app, path);
    });

    console.log(`[Cron] Scheduled ${app.name}${path} → "${schedule}"`);
    scheduled++;
  }

  return scheduled;
}

/**
 * Main entry point
 */
function main(): void {
  console.log("");
  console.log("╔══════════════════════════════════════╗");
  console.log("║     Local Cron Runner (Dev Mode)     ║");
  console.log("╚══════════════════════════════════════╝");
  console.log("");
  
  if (process.env.CRON_SECRET) {
    console.log("[Cron] CRON_SECRET loaded ✓");
  } else {
    console.warn("[Cron] Warning: CRON_SECRET not set - requests may fail with 401");
  }
  console.log("");

  let totalScheduled = 0;

  for (const app of APPS) {
    totalScheduled += scheduleAppCrons(app);
  }

  if (totalScheduled === 0) {
    console.log("[Cron] No cron jobs to schedule. Exiting.");
    process.exit(0);
  }

  console.log("");
  console.log(`[Cron] ${totalScheduled} cron job(s) scheduled. Waiting for triggers...`);
  console.log("[Cron] Press Ctrl+C to stop.");
  console.log("");
}

main();
