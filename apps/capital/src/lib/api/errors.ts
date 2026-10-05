import { ApiError, NETWORK_STATUS } from "./client";

/**
 * Localized error text for anything a request or mutation can throw. The
 * server's own message is English (MCP and the assistant read it), so the
 * UI never shows it: the code picks a message from the next-intl
 * namespace "errors" (`errors.<code>`, e.g. errors.undo.newer_change), and
 * an unknown code falls back to a message per HTTP status.
 *
 * Pure on purpose (tests run in node): pass the `t` of
 * useTranslations("errors"), or use useErrorMessage() from
 * use-app-mutation.ts in components.
 */

export type ErrorValues = Record<string, string | number | Date>;

/** The parts of a next-intl translator this module needs. */
export interface ErrorTranslator {
  (key: string, values?: ErrorValues): string;
  has: (key: string) => boolean;
}

/** Statuses with their own fallback message (errors.status.<n>). */
const STATUS_KEYS = new Set([400, 401, 403, 404, 409, 413, 422, 429, 500]);

function statusKey(status: number): string {
  if (status === NETWORK_STATUS) return "network";
  if (STATUS_KEYS.has(status)) return `status.${status}`;
  return status >= 500 ? "status.500" : "status.400";
}

/** ICU only formats strings, numbers and dates; anything else is dropped. */
function messageValues(params: Record<string, unknown>): ErrorValues | undefined {
  const values: ErrorValues = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" || typeof value === "number" || value instanceof Date) values[key] = value;
    else if (typeof value === "boolean") values[key] = String(value);
  }
  return Object.keys(values).length ? values : undefined;
}

/**
 * Which message to show: `{key, values}` relative to the "errors"
 * namespace. `has` says whether a key exists in the messages.
 */
export function resolveErrorMessage(error: unknown, has: (key: string) => boolean): { key: string; values?: ErrorValues } {
  if (!(error instanceof ApiError)) return { key: "unknown" };
  if (error.code && has(error.code)) return { key: error.code, values: messageValues(error.params) };
  if (error.code === "validation" || (error.status === 422 && error.issues.length)) return { key: "validation" };
  return { key: statusKey(error.status) };
}

export function errorMessage(t: ErrorTranslator, error: unknown): string {
  const { key, values } = resolveErrorMessage(error, (candidate) => t.has(candidate));
  return t(key, values);
}

/** Field paths (dotted) that failed validation, for highlighting inputs after a 422. */
export function invalidFields(error: unknown): Set<string> {
  return new Set(error instanceof ApiError ? error.issues.map((issue) => issue.path).filter(Boolean) : []);
}
