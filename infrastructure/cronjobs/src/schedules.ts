import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface CronJob {
  path: string;
  schedule: string;
}

export interface ScheduleFile {
  crons: CronJob[];
}

export const CRON_APPS = [
  { name: "capital", scheduleFile: "capital.json" },
  { name: "sentinel", scheduleFile: "sentinel.json" },
] as const;

export function schedulesDir(): string {
  return join(__dirname, "../schedules");
}

export function scheduleFilePath(scheduleFile: string): string {
  return join(schedulesDir(), scheduleFile);
}

export function readScheduleFile(filePath: string): ScheduleFile {
  if (!existsSync(filePath)) {
    console.warn(`[Cron] schedule file not found at ${filePath}`);
    return { crons: [] };
  }
  const content = readFileSync(filePath, "utf-8");
  const parsed = JSON.parse(content) as ScheduleFile;
  if (!Array.isArray(parsed.crons)) {
    throw new Error(`[Cron] ${filePath} is missing a crons array`);
  }
  return parsed;
}
