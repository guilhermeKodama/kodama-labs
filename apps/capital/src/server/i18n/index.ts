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

/** Cookie the UI (next-intl) keeps its locale in. */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/** The supported locale a tag names: exact match, then language ("en-US" -> "en"); undefined when none. */
export function matchLocale(value: string | null | undefined): Locale | undefined {
  const tag = value?.trim().toLowerCase();
  if (!tag) return undefined;
  const exact = LOCALES.find((l) => l.toLowerCase() === tag);
  if (exact) return exact;
  const language = tag.split(/[-_]/)[0];
  return LOCALES.find((l) => l.split("-")[0].toLowerCase() === language);
}

/** A supported locale for any input: matchLocale, else pt-BR. */
export function resolveLocale(value: string | null | undefined): Locale {
  return matchLocale(value) ?? DEFAULT_LOCALE;
}

/**
 * The first supported locale of an Accept-Language header, by weight then
 * order ("fr-CA, en;q=0.8, pt;q=0.5" -> "en"); undefined when none matches.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale | undefined {
  if (!acceptLanguage) return undefined;
  const ranges = acceptLanguage
    .split(",")
    .map((part, index) => {
      const [tag, ...attributes] = part.split(";").map((s) => s.trim());
      const q = attributes.find((a) => a.startsWith("q="));
      const weight = q === undefined ? 1 : Number(q.slice(2));
      return { tag, weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((r) => r.tag && r.tag !== "*" && r.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const range of ranges) {
    const locale = matchLocale(range.tag);
    if (locale) return locale;
  }
  return undefined;
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
