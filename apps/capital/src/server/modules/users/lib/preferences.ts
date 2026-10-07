/**
 * The values a user's display preferences may take. The UI formats with them
 * (src/lib/format/prefs.ts reads the same vocabulary) and the MCP settings
 * tool writes them, so both paths go through these lists.
 *
 * Dependency-free: client code may import it.
 */
export const THEMES = ["light", "dark", "system"] as const;
export type Theme = (typeof THEMES)[number];

/** Text size of the UI: Pequeno, Médio, Grande (globals.css scales every text token by it). */
export const TEXT_SIZES = ["sm", "md", "lg"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

/** Number formats are named by the locale whose separators they use: pt-BR is 1.234,56 and en-US is 1,234.56. */
export const NUMBER_FORMATS = ["pt-BR", "en-US"] as const;
export type NumberFormatPref = (typeof NUMBER_FORMATS)[number];

export const DATE_FORMATS = ["dd/MM/yyyy", "yyyy-MM-dd", "MM/dd/yyyy"] as const;
export type DateFormatPref = (typeof DATE_FORMATS)[number];

/** Spellings older screens and clients sent for a number format, by the format they mean. */
const NUMBER_FORMAT_ALIASES: Readonly<Record<string, NumberFormatPref>> = {
  "pt-br": "pt-BR",
  "1.234,56": "pt-BR",
  "en-us": "en-US",
  "1,234.56": "en-US",
};

/** The stored spelling of a number format, or undefined when it is not one. Accepts the older "1.234,56" / "1,234.56" spellings. */
export function normalizeNumberFormat(value: string): NumberFormatPref | undefined {
  return NUMBER_FORMAT_ALIASES[value.trim().toLowerCase()];
}

export function isDateFormat(value: string): value is DateFormatPref {
  return (DATE_FORMATS as readonly string[]).includes(value);
}

export function isTheme(value: string): value is Theme {
  return (THEMES as readonly string[]).includes(value);
}

export function isTextSize(value: string): value is TextSize {
  return (TEXT_SIZES as readonly string[]).includes(value);
}
