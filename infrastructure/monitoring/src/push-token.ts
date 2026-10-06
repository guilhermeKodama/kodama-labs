import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** Stable Kuma push-monitor name for one cron endpoint. */
export function cronMonitorName(app: string, cronPath: string): string {
  const slug = cronPath.replace(/^\//, "").replace(/\//g, "-");
  return `kodama/cron-${app}-${slug}`;
}

/**
 * Deterministic push token. Kuma 2.5.3 stores a client-supplied `pushToken`
 * on add (`bean.import`) and on edit (`bean.pushToken = monitor.pushToken`).
 * The disk timer reproduces this with `sha256sum` of the same bytes.
 */
export function pushToken(secret: string, monitorName: string): string {
  return createHash("sha256").update(`${secret}:${monitorName}`, "utf8").digest("hex");
}

export function readPushTokenFile(filePath: string): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.length > 0) out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

/** File wins when the server rejected our deterministic token. */
export function resolvePushToken(
  secret: string,
  monitorName: string,
  overrides: Record<string, string> = {},
): string {
  return overrides[monitorName] ?? pushToken(secret, monitorName);
}
