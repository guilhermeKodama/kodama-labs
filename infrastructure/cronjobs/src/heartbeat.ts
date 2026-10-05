import { cronMonitorName, pushToken, readPushTokenFile, resolvePushToken } from "@infrastructure/monitoring/push-token";

let warned = false;

/**
 * Push status=up after a successful cron run.
 *
 * A failed run does not push status=down. Kuma's push monitor counts a
 * missing heartbeat as a failure, and maxretries (default 1) turns the
 * second consecutive miss into Down. Pushing down as well would let the
 * monitor's own timeout count as the second failure and page on one miss.
 */
export async function pushHeartbeat(app: string, cronPath: string, ok: boolean): Promise<void> {
  if (!ok) return;
  const base = process.env.KUMA_PUSH_BASE_URL?.trim();
  const secret = process.env.KUMA_PUSH_TOKEN_SECRET?.trim();
  if (!base || !secret) {
    if (!warned) {
      warned = true;
      console.log("[Cron] KUMA_PUSH_BASE_URL or KUMA_PUSH_TOKEN_SECRET unset; heartbeats disabled");
    }
    return;
  }

  const name = cronMonitorName(app, cronPath);
  const file = process.env.KUMA_PUSH_TOKEN_FILE?.trim();
  const overrides = file ? readPushTokenFile(file) : {};
  const token = resolvePushToken(secret, name, overrides);
  const url = `${base.replace(/\/$/, "")}/api/push/${token}?status=up&msg=ok&ping=`;
  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`[Cron] kuma push ${name} failed with status ${response.status}`);
    }
  } catch (error) {
    console.error(`[Cron] kuma push ${name} error:`, error);
  }
}

export { cronMonitorName, pushToken };
