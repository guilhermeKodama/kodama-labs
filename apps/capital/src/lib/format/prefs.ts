/**
 * The user's display preferences (Ajustes → Perfil) as the formatter needs
 * them. Stored values predate the new UI ("1.234,56", "en-US", "yyyy-MM-dd"
 * …), so everything read from the session goes through normalize*.
 */

export const NUMBER_FORMATS = ["pt-BR", "en-US"] as const;
/** pt-BR: 1.234,56 · en-US: 1,234.56 */
export type NumberFormat = (typeof NUMBER_FORMATS)[number];

export const DATE_FORMATS = ["dd/MM/yyyy", "yyyy-MM-dd", "MM/dd/yyyy"] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];

export const APP_LOCALES = ["pt-BR", "en"] as const;
export type AppLocale = (typeof APP_LOCALES)[number];

export interface FormatPrefs {
  numberFormat: NumberFormat;
  dateFormat: DateFormat;
  /** IANA zone used for timestamps (createdAt, "hoje 13:00"); plain dates are never shifted. */
  timezone: string;
  /** UI language: month names and words like "hoje". */
  locale: AppLocale;
  baseCurrency: string;
}

/** New-user defaults (signup), also used before the session loads. */
export const DEFAULT_FORMAT_PREFS: FormatPrefs = {
  numberFormat: "pt-BR",
  dateFormat: "dd/MM/yyyy",
  timezone: "America/Sao_Paulo",
  locale: "pt-BR",
  baseCurrency: "BRL",
};

// Comma-decimal locales the old settings offered, and the sample strings it stored.
const NUMBER_ALIASES: Record<string, NumberFormat> = {
  "pt-br": "pt-BR",
  pt: "pt-BR",
  "de-de": "pt-BR",
  "1.234,56": "pt-BR",
  "en-us": "en-US",
  en: "en-US",
  "1,234.56": "en-US",
};

export function normalizeNumberFormat(value: unknown, fallback: NumberFormat = DEFAULT_FORMAT_PREFS.numberFormat): NumberFormat {
  return typeof value === "string" ? (NUMBER_ALIASES[value.trim().toLowerCase()] ?? fallback) : fallback;
}

export function normalizeDateFormat(value: unknown, fallback: DateFormat = DEFAULT_FORMAT_PREFS.dateFormat): DateFormat {
  if (typeof value !== "string") return fallback;
  const lower = value.trim().toLowerCase();
  return DATE_FORMATS.find((format) => format.toLowerCase() === lower) ?? fallback;
}

export function normalizeLocale(value: unknown, fallback: AppLocale = DEFAULT_FORMAT_PREFS.locale): AppLocale {
  if (typeof value !== "string") return fallback;
  const language = value.trim().toLowerCase().split(/[-_]/)[0];
  return language === "en" ? "en" : language === "pt" ? "pt-BR" : fallback;
}

export function normalizeTimezone(value: unknown, fallback = DEFAULT_FORMAT_PREFS.timezone): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value.trim() });
    return value.trim();
  } catch {
    return fallback;
  }
}

export function normalizeCurrency(value: unknown, fallback = DEFAULT_FORMAT_PREFS.baseCurrency): string {
  return typeof value === "string" && /^[a-z]{3}$/i.test(value.trim()) ? value.trim().toUpperCase() : fallback;
}

/** Full preferences from whatever the session has (missing or unknown values get the defaults). */
export function resolveFormatPrefs(input?: Partial<Record<keyof FormatPrefs, unknown>> | null): FormatPrefs {
  return {
    numberFormat: normalizeNumberFormat(input?.numberFormat),
    dateFormat: normalizeDateFormat(input?.dateFormat),
    timezone: normalizeTimezone(input?.timezone),
    locale: normalizeLocale(input?.locale),
    baseCurrency: normalizeCurrency(input?.baseCurrency),
  };
}
