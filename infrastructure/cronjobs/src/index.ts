/**
 * Cron runner.
 *
 * Reads infrastructure/cronjobs/schedules/<app>.json and fires each path
 * on the app's base URL. Works against localhost in dev and against the
 * compose network in prod (CAPITAL_BASE_URL / SENTINEL_BASE_URL).
 */

import "dotenv/config";
import cron from "node-cron";
import { CRON_APPS, readScheduleFile, scheduleFilePath, type CronJob } from "./schedules";

interface AppConfig {
  name: string;
  baseUrl: string;
  scheduleFile: string;
  cronSecret?: string;
}

const BASE_URLS: Record<(typeof CRON_APPS)[number]["name"], string> = {
  capital: process.env.CAPITAL_BASE_URL ?? "http://localhost:3000",
  sentinel: process.env.SENTINEL_BASE_URL ?? "http://localhost:3002",
};

const CRON_SECRETS: Record<(typeof CRON_APPS)[number]["name"], string | undefined> = {
  capital: process.env.CAPITAL_CRON_SECRET ?? process.env.CRON_SECRET,
  sentinel: process.env.SENTINEL_CRON_SECRET ?? process.env.CRON_SECRET,
};

const ALL_APPS: AppConfig[] = CRON_APPS.map((app) => ({
  name: app.name,
  baseUrl: BASE_URLS[app.name],
  scheduleFile: app.scheduleFile,
  cronSecret: CRON_SECRETS[app.name],
}));

// CRON_APPS limits which apps this process fires. Default is both.
const enabledNames = (process.env.CRON_APPS ?? "capital,sentinel")
  .split(",")
  .map((n) => n.trim());
const APPS: AppConfig[] = ALL_APPS.filter((app) => enabledNames.includes(app.name));

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
function loadAppCrons(app: AppConfig): CronJob[] {
  try {
    return readScheduleFile(scheduleFilePath(app.scheduleFile)).crons;
  } catch (error) {
    console.error(`[Cron] Error reading ${app.scheduleFile}:`, error);
    return [];
  }
}

function scheduleAppCrons(app: AppConfig): number {
  const crons = loadAppCrons(app);

  if (crons.length === 0) {
    console.log(`[Cron] No crons found for ${app.name}`);
    return 0;
  }

  let scheduled = 0;

  for (const { path, schedule } of crons) {
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
  console.log("║             Cron Runner              ║");
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
