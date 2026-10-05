import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { cronPeriodSeconds, PUSH_GRACE_SECONDS } from "./cron-period.js";
import { cronMonitorName } from "./push-token.js";

export const MANAGED_PREFIX = "kodama/";

/**
 * Push-monitor overrides, keyed by "<app>:<path>" as in the schedule JSON
 * (example: "capital:/api/cron/send-reminders").
 *
 * Default maxretries is 1. Kuma 2.5.3 treats the first missed push window as
 * PENDING and the next as DOWN, so a single failed run (or one missed
 * heartbeat) does not notify. Set maxretries to 0 to page on the first miss.
 *
 * The cron runner only pushes status=up after a success. A failure is a
 * missed heartbeat on purpose: pushing status=down would also trip the
 * monitor's own timeout and count as the second failure immediately.
 *
 * interval = job period + graceSeconds (default 60). retryInterval = job
 * period, so the second check lands about one period after the first miss.
 */
export const CRON_PUSH_OVERRIDES: Record<string, { maxretries?: number; graceSeconds?: number }> = {
  // "capital:/api/cron/send-reminders": { maxretries: 0 },
};

export interface MonitorDesired {
  name: string;
  type: string;
  interval: number;
  retryInterval: number;
  maxretries: number;
  resendInterval: number;
  accepted_statuscodes: string[];
  maxredirects?: number;
  url?: string;
  method?: string;
  docker_container?: string;
  databaseConnectionString?: string;
  databaseQuery?: string;
  /** Set by the provisioner once the Docker host id is known. */
  docker_host?: number | null;
  /** Set by the provisioner from KUMA_PUSH_TOKEN_SECRET. */
  pushToken?: string | null;
}

const HTTP_DEFAULTS = {
  interval: 60,
  retryInterval: 60,
  maxretries: 2,
  resendInterval: 0,
  accepted_statuscodes: ["200-299"],
  maxredirects: 10,
  method: "GET",
} as const;

export const DOCKER_SERVICES = [
  "capital-web",
  "sentinel-web",
  "careers-web",
  "careers-jobs",
  "careers-sources",
  "careers-maintenance",
  "attention-web",
  "attention-whatsapp",
  "attention-maintenance",
  "attention-jobs",
  "kodamalabs-web",
  "cloudflared",
  "cronjobs",
  "log-watcher",
  "docker-socket-proxy",
] as const;

const INTERNAL_HTTP: Array<{ name: string; url: string }> = [
  { name: "kodama/capital-web", url: "http://capital-web:3000/api/health" },
  { name: "kodama/sentinel-web", url: "http://sentinel-web:3002/api/health" },
  { name: "kodama/careers-web", url: "http://careers-web:3006/api/health" },
  { name: "kodama/attention-web", url: "http://attention-web:3005/api/health" },
  { name: "kodama/kodamalabs-web", url: "http://kodamalabs-web:3003/api/health" },
];

const DEFAULT_PUBLIC: Array<{ name: string; url: string }> = [
  { name: "kodama/public-capital-login", url: "https://capital.kodamalabs.ai/login" },
  { name: "kodama/public-careers", url: "https://careers.kodamalabs.ai/" },
  { name: "kodama/public-attention", url: "https://attentio.dev/" },
];

export interface SpecEnv {
  composeProject?: string | undefined;
  postgresUser?: string | undefined;
  postgresPassword?: string | undefined;
  extraPublicHosts?: string | undefined;
  ollamaHealthUrl?: string | undefined;
  whisperHealthUrl?: string | undefined;
  schedulesDir?: string | undefined;
}

export function schedulesDirFromHere(moduleUrl: string): string {
  const here = new URL(".", moduleUrl);
  return join(filePath(here), "../../cronjobs/schedules");
}

function filePath(url: URL): string {
  return decodeURIComponent(url.pathname);
}

export function buildMonitors(env: SpecEnv = {}): MonitorDesired[] {
  const project = env.composeProject?.trim() || "kodama-prod";
  const monitors: MonitorDesired[] = [];

  for (const target of INTERNAL_HTTP) {
    monitors.push({
      ...HTTP_DEFAULTS,
      accepted_statuscodes: [...HTTP_DEFAULTS.accepted_statuscodes],
      type: "http",
      name: target.name,
      url: target.url,
    });
  }

  for (const target of [...DEFAULT_PUBLIC, ...extraPublic(env.extraPublicHosts)]) {
    monitors.push({
      ...HTTP_DEFAULTS,
      type: "http",
      name: target.name,
      url: target.url,
      maxredirects: 0,
      accepted_statuscodes: ["200-399"],
    });
  }

  const user = env.postgresUser?.trim() || "root";
  const password = env.postgresPassword ?? "root";
  for (const database of ["capital", "sentinel", "attention", "careers"]) {
    monitors.push({
      type: "postgres",
      name: `kodama/postgres-${database}`,
      interval: 60,
      retryInterval: 60,
      maxretries: 2,
      resendInterval: 0,
      accepted_statuscodes: ["200-299"],
      databaseConnectionString: postgresUrl(user, password, database),
      databaseQuery: "SELECT 1",
    });
  }

  for (const service of DOCKER_SERVICES) {
    monitors.push({
      type: "docker",
      name: `kodama/docker-${service}`,
      interval: 60,
      retryInterval: 60,
      maxretries: 2,
      resendInterval: 0,
      accepted_statuscodes: ["200-299"],
      docker_container: `${project}-${service}-1`,
    });
  }

  if (env.schedulesDir) {
    monitors.push(...cronPushMonitors(env.schedulesDir));
  }

  monitors.push({
    type: "push",
    name: "kodama/host-disk",
    interval: 15 * 60,
    retryInterval: 15 * 60,
    maxretries: 0,
    resendInterval: 0,
    accepted_statuscodes: ["200-299"],
  });

  const ollama = env.ollamaHealthUrl?.trim();
  if (ollama) {
    monitors.push({
      ...HTTP_DEFAULTS,
      accepted_statuscodes: [...HTTP_DEFAULTS.accepted_statuscodes],
      type: "http",
      name: "kodama/ollama",
      url: ollama,
    });
  }
  const whisper = env.whisperHealthUrl?.trim();
  if (whisper) {
    monitors.push({
      ...HTTP_DEFAULTS,
      accepted_statuscodes: [...HTTP_DEFAULTS.accepted_statuscodes],
      type: "http",
      name: "kodama/whisper",
      url: whisper,
    });
  }

  return monitors;
}

export function cronPushMonitors(dir: string): MonitorDesired[] {
  const monitors: MonitorDesired[] = [];
  let files: string[] = [];
  try {
    files = readdirSync(dir).filter((name) => name.endsWith(".json"));
  } catch {
    return monitors;
  }
  for (const file of files.sort()) {
    const app = file.replace(/\.json$/, "");
    const parsed = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
      crons?: Array<{ path?: string; schedule?: string }>;
    };
    for (const job of parsed.crons ?? []) {
      if (!job.path || !job.schedule) continue;
      const period = cronPeriodSeconds(job.schedule);
      const override = CRON_PUSH_OVERRIDES[`${app}:${job.path}`] ?? {};
      const grace = override.graceSeconds ?? PUSH_GRACE_SECONDS;
      monitors.push({
        type: "push",
        name: cronMonitorName(app, job.path),
        interval: period + grace,
        retryInterval: period,
        maxretries: override.maxretries ?? 1,
        resendInterval: 0,
        accepted_statuscodes: ["200-299"],
      });
    }
  }
  return monitors;
}

function extraPublic(raw: string | undefined): Array<{ name: string; url: string }> {
  if (!raw?.trim()) return [];
  const out: Array<{ name: string; url: string }> = [];
  for (const piece of raw.split(",")) {
    const trimmed = piece.trim();
    if (!trimmed) continue;
    const url = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let host = trimmed;
    try {
      host = new URL(url).hostname;
    } catch {
      host = trimmed.replace(/[^a-z0-9.-]+/gi, "-");
    }
    out.push({ name: `kodama/public-${host}`, url });
  }
  return out;
}

function postgresUrl(user: string, password: string, database: string): string {
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@postgres:5432/${database}`;
}

export function managedHash(monitor: MonitorDesired): string {
  return createHash("sha256").update(stableStringify(monitor)).digest("hex").slice(0, 20);
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
