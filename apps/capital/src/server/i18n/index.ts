import { categories } from "./categories";
import { common } from "./common";
import type { LeafPaths } from "./define";
import { ledger } from "./ledger";
import { views } from "./views";

/**
 * Server-side strings (names the server writes, export headers, ...), one
 * dictionary per domain. Error messages are not here: the API sends a code
 * (./error-codes.ts) and the UI translates it.
 */

export const LOCALES = ["pt-BR", "en"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "pt-BR";

const DICTIONARIES = { common, ledger, views, categories };
type Dictionaries = typeof DICTIONARIES;

/** "<domain>.<path>", e.g. "ledger.direction.reimbursement". */
export type MessageKey = { [D in keyof Dictionaries & string]: LeafPaths<Dictionaries[D]["pt-BR"], `${D}.`> }[keyof Dictionaries & string];
export type MessageParams = Record<string, string | number>;

/** A supported locale for any input: exact match, then language ("en-US" -> "en"), else pt-BR. */
export function resolveLocale(value: string | null | undefined): Locale {
  if (!value) return DEFAULT_LOCALE;
  const exact = LOCALES.find((l) => l.toLowerCase() === value.toLowerCase());
  if (exact) return exact;
  const language = value.split(/[-_]/)[0].toLowerCase();
  return LOCALES.find((l) => l.split("-")[0].toLowerCase() === language) ?? DEFAULT_LOCALE;
}

function lookup(locale: Locale, key: string): string | undefined {
  const [domain, ...path] = key.split(".");
  let node: unknown = (DICTIONARIES as Record<string, Record<Locale, unknown>>)[domain]?.[locale];
  for (const part of path) node = node && typeof node === "object" ? (node as Record<string, unknown>)[part] : undefined;
  return typeof node === "string" ? node : undefined;
}

/** Replaces `{name}` with params.name; unknown placeholders stay as they are. */
function interpolate(template: string, params: MessageParams): string {
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match));
}

/** Server translation: the string for `key` in `locale` (pt-BR when unknown), with `{params}` filled in. */
export function st(locale: string | null | undefined, key: MessageKey, params?: MessageParams): string {
  const template = lookup(resolveLocale(locale), key) ?? lookup(DEFAULT_LOCALE, key) ?? key;
  return params ? interpolate(template, params) : template;
}
