import type { PluggyItemPayload } from "./types";

const DAY = 24 * 60 * 60 * 1000;
export const CONSENT_WARNING_DAYS = 30;

export type ConsentState = "ok" | "expiring" | "expired";

/** Meu Pluggy consent lasts a year. A past date, or USER_AUTHORIZATION_EXPIRED, stops the read. */
export function consentState(item: PluggyItemPayload, now: Date): ConsentState {
  const code = item.error?.code;
  if (item.status === "LOGIN_ERROR" && code === "USER_AUTHORIZATION_EXPIRED") return "expired";
  if (code === "USER_AUTHORIZATION_EXPIRED") return "expired";
  if (!item.consentExpiresAt) return item.status === "LOGIN_ERROR" ? "expired" : "ok";
  const at = new Date(item.consentExpiresAt).getTime();
  if (Number.isNaN(at)) return "ok";
  if (at <= now.getTime()) return "expired";
  if (at - now.getTime() <= CONSENT_WARNING_DAYS * DAY) return "expiring";
  return "ok";
}

const OVERLAP_DAYS = 7;
const FIRST_SYNC_DAYS = 365;

/** Incremental window: seven days of overlap, or a year on the first success. */
export function sinceDate(lastSuccess: Date | null, now: Date): string {
  const from = lastSuccess
    ? new Date(lastSuccess.getTime() - OVERLAP_DAYS * DAY)
    : new Date(now.getTime() - FIRST_SYNC_DAYS * DAY);
  return from.toISOString().slice(0, 10);
}

export function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

export function onOrAfter(iso: string, since: string): boolean {
  return dayOf(iso) >= since;
}
