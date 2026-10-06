import { DEFAULT_FORMAT_PREFS, resolveFormatPrefs, type AppLocale, type DateFormat, type FormatPrefs, type NumberFormat } from "./prefs";

/**
 * Pure number/date formatting from the user's preferences. For pt-BR it
 * reproduces the mockup helpers exactly (mockup lines 40–44):
 *   fmt  = |n| with 2 decimals        → "1.234,56"
 *   brl  = sign + "R$ " + fmt(n)      → "−R$ 1.234,56" (U+2212 minus)
 *   brl0 = sign + "R$ " + round(|n|)  → "−R$ 1.235"
 *   pct  = (n·100) with d decimals + "%" → "12,3%"
 * Components get an instance from useFmt() (provider.tsx).
 */

/** A plain date ("2026-09-22"), a month ("2026-09"), a timestamp string, epoch ms or a Date. */
export type DateInput = string | number | Date;

/** Date buckets of the ledger query engine (group keys). */
export type DateBucket = "day" | "week" | "monthWeek" | "month" | "quarter" | "year";

const SYMBOLS: Record<string, string> = { BRL: "R$", USD: "US$", EUR: "€", GBP: "£", JPY: "¥" };

const MINUS = "−";

interface Vocab {
  monthAbbr: readonly string[];
  monthName: readonly string[];
  monthLabel: (abbr: string, year: number) => string;
  week: (n: number) => string;
  weekOf: (date: string) => string;
  quarter: (q: number, year: number) => string;
  thousands: string;
  now: string;
  today: string;
  yesterday: string;
}

const VOCAB: Record<AppLocale, Vocab> = {
  "pt-BR": {
    monthAbbr: ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"],
    monthName: ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"],
    monthLabel: (abbr, year) => `${abbr}/${year}`,
    week: (n) => `Sem. ${n}`,
    weekOf: (date) => `Sem. de ${date}`,
    quarter: (q, year) => `T${q} ${year}`,
    thousands: "mil",
    now: "agora",
    today: "hoje",
    yesterday: "ontem",
  },
  en: {
    monthAbbr: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
    monthName: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
    monthLabel: (abbr, year) => `${abbr} ${year}`,
    week: (n) => `Wk ${n}`,
    weekOf: (date) => `Week of ${date}`,
    quarter: (q, year) => `Q${q} ${year}`,
    thousands: "k",
    now: "now",
    today: "today",
    yesterday: "yesterday",
  },
};

const numberFormats = new Map<string, Intl.NumberFormat>();
function numberFormat(locale: NumberFormat, min: number, max: number): Intl.NumberFormat {
  const key = `${locale}|${min}|${max}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max });
    numberFormats.set(key, format);
  }
  return format;
}

interface Moment {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** False for plain dates and months, which have no time of day. */
  hasTime: boolean;
}

const zoneFormats = new Map<string, Intl.DateTimeFormat>();
function zonedMoment(date: Date, timeZone: string): Moment {
  let format = zoneFormats.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      hourCycle: "h23",
    });
    zoneFormats.set(timeZone, format);
  }
  const parts = Object.fromEntries(format.formatToParts(date).map((part) => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), day: Number(parts.day), hour: Number(parts.hour) % 24, minute: Number(parts.minute), hasTime: true };
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
// Prisma @db.Date columns serialized with toISOString(): a calendar date, not midnight UTC.
const DATE_AT_UTC_MIDNIGHT = /^(\d{4})-(\d{2})-(\d{2})T00:00:00(?:\.0+)?Z$/;
const MONTH_ONLY = /^(\d{4})-(\d{2})$/;

function toMoment(value: DateInput | null | undefined, timeZone: string): Moment | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "string") {
    const date = DATE_ONLY.exec(value) ?? DATE_AT_UTC_MIDNIGHT.exec(value);
    if (date) return { year: Number(date[1]), month: Number(date[2]), day: Number(date[3]), hour: 0, minute: 0, hasTime: false };
    const month = MONTH_ONLY.exec(value);
    if (month) return { year: Number(month[1]), month: Number(month[2]), day: 1, hour: 0, minute: 0, hasTime: false };
  }
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : zonedMoment(date, timeZone);
}

const pad = (n: number) => String(n).padStart(2, "0");

function shortDate(m: { month: number; day: number }, format: DateFormat): string {
  if (format === "MM/dd/yyyy") return `${pad(m.month)}/${pad(m.day)}`;
  if (format === "yyyy-MM-dd") return `${pad(m.month)}-${pad(m.day)}`;
  return `${pad(m.day)}/${pad(m.month)}`;
}

function fullDate(m: { year: number; month: number; day: number }, format: DateFormat): string {
  if (format === "MM/dd/yyyy") return `${pad(m.month)}/${pad(m.day)}/${m.year}`;
  if (format === "yyyy-MM-dd") return `${m.year}-${pad(m.month)}-${pad(m.day)}`;
  return `${pad(m.day)}/${pad(m.month)}/${m.year}`;
}

const lastDayOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month, 0)).getUTCDate();
const dayNumber = (m: { year: number; month: number; day: number }) => Date.UTC(m.year, m.month - 1, m.day) / 86_400_000;

/**
 * Reads a number typed in either convention. With the user's decimal
 * separator present, the other one is grouping ("1.234,56"). Without it, a
 * separator followed by groups of exactly three digits is grouping
 * ("1.234" → 1234 in pt-BR), and a single other separator is taken as the
 * decimal point ("86.90" → 86.9). Currency symbols and spaces are ignored.
 * NaN when nothing sensible is left.
 */
export function parseLocaleNumber(input: string, numberFormat: NumberFormat): number {
  const negative = /^\s*[-−–]/.test(input) || /^\s*\(.*\)\s*$/.test(input);
  const raw = input.replace(/[^\d.,]/g, "");
  if (!/\d/.test(raw)) return Number.NaN;
  const decimal = numberFormat === "pt-BR" ? "," : ".";
  const group = decimal === "," ? "." : ",";
  let normalized: string;
  if (raw.includes(decimal)) {
    if (raw.split(decimal).length > 2) return Number.NaN;
    normalized = raw.split(group).join("").replace(decimal, ".");
  } else if (raw.includes(group)) {
    const parts = raw.split(group);
    if (/^\d{1,3}$/.test(parts[0]) && parts.slice(1).every((part) => /^\d{3}$/.test(part))) normalized = parts.join("");
    else if (parts.length === 2) normalized = parts.join(".");
    else return Number.NaN;
  } else {
    normalized = raw;
  }
  const value = Number(normalized);
  return Number.isFinite(value) ? (negative ? -value : value) : Number.NaN;
}

export interface Formatter {
  readonly prefs: FormatPrefs;
  /** "R$", "US$", "€"; the code itself for currencies without a symbol. */
  currencySymbol(currency?: string | null): string;
  /** Grouped number: 2 decimals by default, or exactly `digits`, or a {min, max} range. */
  number(value: number, digits?: number | { min: number; max: number }): string;
  /** "R$ 1.234,56", "−R$ 86,90" (mockup brl). */
  money(value: number, currency?: string | null): string;
  /** "R$ 1.235", rounded to units (mockup brl0). */
  money0(value: number, currency?: string | null): string;
  /** Thousands with a "k": "1,2k" (charts, waterfall labels); `minDigits: 1` gives "1,0k" (heatmap). */
  k(value: number, options?: { minDigits?: number; maxDigits?: number }): string;
  /** Value in thousands rounded to one decimal, for "R$ mil" chart series. */
  thousands(value: number): number;
  /** Unit label of thousands() series: "R$ mil". */
  kUnit(currency?: string | null): string;
  /** 0.123 → "12,3%" (mockup pct). */
  pct(value: number, digits?: number): string;
  /** Short date per the date format: "22/09". */
  date(value: DateInput | null | undefined): string;
  /** "22/09/2026". */
  dateFull(value: DateInput | null | undefined): string;
  /** "13:00" ("1:00 PM" in English), in the user's timezone. */
  time(value: DateInput | null | undefined): string;
  /** "23/09 09:12"; with the year when it is not the current one. */
  dateTime(value: DateInput | null | undefined, now?: Date): string;
  /** "set/2026" ("Sep 2026"). */
  monthLabel(value: DateInput | { year: number; month: number } | null | undefined): string;
  /** Month 1–12 → "set" ("Sep"). */
  monthAbbr(month: number): string;
  /** Month 1–12 → "setembro" ("September"). */
  monthName(month: number): string;
  /**
   * "jul/2026 – set/2026" for whole months, "set/2026" for one, "05/09 – 20/09"
   * for other ranges (full dates outside the current year).
   */
  periodRangeLabel(from: DateInput, to: DateInput, now?: Date): string;
  /** Label of a date group key: "Sem. 3 · set" (monthWeek YYYY-MM-Wn), "T3 2026" (quarter YYYY-Qn), … */
  bucketLabel(bucket: DateBucket, key: string): string;
  /** "agora", "hoje 13:00", "ontem", then a date. */
  relative(value: DateInput | null | undefined, now?: Date): string;
  /** Parses a typed amount in the user's number format (see parseLocaleNumber). */
  parseNumber(input: string): number;
}

/**
 * Formatter for a set of preferences. Takes raw stored values: legacy,
 * unknown or missing ones are normalized to the defaults (prefs.ts).
 */
export function createFormatter(input: Partial<Record<keyof FormatPrefs, unknown>> = DEFAULT_FORMAT_PREFS): Formatter {
  const prefs = resolveFormatPrefs(input);
  const { numberFormat: nf, dateFormat: df, timezone } = prefs;
  const vocab = VOCAB[prefs.locale];

  const currencySymbol = (currency?: string | null) => {
    const code = currency || prefs.baseCurrency;
    return SYMBOLS[code] ?? code;
  };
  const number = (value: number, digits: number | { min: number; max: number } = 2) => {
    if (!Number.isFinite(value)) return "—";
    const { min, max } = typeof digits === "number" ? { min: digits, max: digits } : digits;
    return numberFormat(nf, min, max).format(value);
  };
  const money = (value: number, currency?: string | null) =>
    Number.isFinite(value) ? `${value < 0 ? MINUS : ""}${currencySymbol(currency)} ${number(Math.abs(value), 2)}` : "—";
  const money0 = (value: number, currency?: string | null) =>
    Number.isFinite(value) ? `${value < 0 ? MINUS : ""}${currencySymbol(currency)} ${number(Math.round(Math.abs(value)), 0)}` : "—";
  const time = (m: Moment) => {
    if (prefs.locale === "en") return `${m.hour % 12 || 12}:${pad(m.minute)} ${m.hour < 12 ? "AM" : "PM"}`;
    return `${pad(m.hour)}:${pad(m.minute)}`;
  };
  const monthLabelOf = (m: { year: number; month: number }) => vocab.monthLabel(vocab.monthAbbr[m.month - 1] ?? String(m.month), m.year);
  const at = (value: DateInput | null | undefined) => toMoment(value, timezone);

  const formatter: Formatter = {
    prefs,
    currencySymbol,
    number,
    money,
    money0,
    k: (value, { minDigits = 0, maxDigits = 1 } = {}) => (Number.isFinite(value) ? `${numberFormat(nf, minDigits, maxDigits).format(value / 1000)}k` : "—"),
    thousands: (value) => Math.round(value / 100) / 10,
    kUnit: (currency) => `${currencySymbol(currency)} ${vocab.thousands}`,
    pct: (value, digits = 1) => (Number.isFinite(value) ? `${number(value * 100, digits)}%` : "—"),
    date(value) {
      const m = at(value);
      return m ? shortDate(m, df) : "";
    },
    dateFull(value) {
      const m = at(value);
      return m ? fullDate(m, df) : "";
    },
    time(value) {
      const m = at(value);
      return m ? time(m) : "";
    },
    dateTime(value, now = new Date()) {
      const m = at(value);
      if (!m) return "";
      const day = m.year === zonedMoment(now, timezone).year ? shortDate(m, df) : fullDate(m, df);
      return m.hasTime ? `${day} ${time(m)}` : day;
    },
    monthLabel(value) {
      if (value !== null && typeof value === "object" && !(value instanceof Date)) return monthLabelOf(value);
      const m = at(value);
      return m ? monthLabelOf(m) : "";
    },
    monthAbbr: (month) => vocab.monthAbbr[month - 1] ?? String(month),
    monthName: (month) => vocab.monthName[month - 1] ?? String(month),
    periodRangeLabel(from, to, now = new Date()) {
      const a = at(from);
      const b = at(to);
      if (!a || !b) return a ? monthLabelOf(a) : b ? monthLabelOf(b) : "";
      const wholeMonths = a.day === 1 && (b.day === lastDayOfMonth(b.year, b.month) || (typeof to === "string" && MONTH_ONLY.test(to)));
      if (wholeMonths) {
        const first = monthLabelOf(a);
        const last = monthLabelOf(b);
        return first === last ? first : `${first} – ${last}`;
      }
      if (dayNumber(a) === dayNumber(b)) return a.year === b.year ? shortDate(a, df) : fullDate(a, df);
      const sameYear = a.year === b.year && a.year === zonedMoment(now, timezone).year;
      return sameYear ? `${shortDate(a, df)} – ${shortDate(b, df)}` : `${fullDate(a, df)} – ${fullDate(b, df)}`;
    },
    bucketLabel(bucket, key) {
      switch (bucket) {
        case "day": {
          const m = DATE_ONLY.test(key) ? at(key) : null;
          return m ? shortDate(m, df) : key;
        }
        case "week": {
          const iso = /^(\d{4})-W(\d{1,2})$/.exec(key);
          if (iso) return `${vocab.week(Number(iso[2]))} · ${iso[1]}`;
          const m = DATE_ONLY.test(key) ? at(key) : null;
          return m ? vocab.weekOf(shortDate(m, df)) : key;
        }
        case "monthWeek": {
          const match = /^(\d{4})-(\d{2})-W(\d)$/.exec(key);
          return match ? `${vocab.week(Number(match[3]))} · ${formatter.monthAbbr(Number(match[2]))}` : key;
        }
        case "month": {
          const match = MONTH_ONLY.exec(key);
          return match ? monthLabelOf({ year: Number(match[1]), month: Number(match[2]) }) : key;
        }
        case "quarter": {
          const match = /^(\d{4})-Q([1-4])$/.exec(key);
          return match ? vocab.quarter(Number(match[2]), Number(match[1])) : key;
        }
        case "year":
          return key;
      }
    },
    relative(value, now = new Date()) {
      const m = at(value);
      if (!m) return "";
      const ref = zonedMoment(now, timezone);
      if (m.hasTime) {
        const instant = value instanceof Date ? value.getTime() : new Date(value as string | number).getTime();
        if (Math.abs(now.getTime() - instant) < 60_000) return vocab.now;
      }
      const days = dayNumber(ref) - dayNumber(m);
      if (days === 0) return m.hasTime ? `${vocab.today} ${time(m)}` : vocab.today;
      if (days === 1) return vocab.yesterday;
      return m.year === ref.year ? shortDate(m, df) : fullDate(m, df);
    },
    parseNumber: (input) => parseLocaleNumber(input, nf),
  };
  return formatter;
}
