import type { AssetClass } from "@/generated/prisma";
import { isBrazilianTicker } from "./ticker";

/**
 * Trading calendars: which close a price should be at, right now, for each
 * market. Freshness is measured in sessions, not hours, because a price
 * dated by its trading day is never "30 hours old" in any useful sense —
 * Monday's close is the right price all of Tuesday until Tuesday's close
 * exists, and Friday's is right all weekend.
 *
 * A session's close counts as "expected" from CLOSE_READY (local time) on
 * that day: about an hour after the market closes, and before the
 * market-close pipeline runs (22:30 UTC, i.e. 19:30 in São Paulo and
 * 17:30/18:30 in New York). Holidays come from the tables below; a closure they miss (an
 * unscheduled one, a rule change) costs one session of tolerance, which
 * holdingPriceStatus allows anyway, never a false alarm on its own.
 *
 * Pure: no DB, no network. Everything takes `now` so tests pin the clock.
 */

/** Stored on Asset.market. Free text in the DB so a new market needs no enum migration. */
export type Market = "B3" | "US" | "CRYPTO";

interface SessionRules {
  timeZone: string;
  /** Local hh:mm from which the session's close is considered available. */
  closeReady: { hour: number; minute: number };
  isHoliday: (dateIso: string) => boolean;
}

const RULES: Record<Exclude<Market, "CRYPTO">, SessionRules> = {
  // B3 closes at 17:00, or 18:00 while the US is on standard time (closing call ~10 min after); ready an hour after the later one.
  B3: { timeZone: "America/Sao_Paulo", closeReady: { hour: 19, minute: 0 }, isHoliday: (d) => holidaysFor("B3", d).has(d) },
  // NYSE/Nasdaq close at 16:00 ET.
  US: { timeZone: "America/New_York", closeReady: { hour: 17, minute: 0 }, isHoliday: (d) => holidaysFor("US", d).has(d) },
};

/** Where an asset trades, from its class and (for "etf", which is either) its ticker. Null when nothing trades it on a market we follow (fixed income, savings). */
export function marketFor(assetClass: AssetClass, ticker?: string | null): Market | null {
  switch (assetClass) {
    case "crypto":
      return "CRYPTO";
    case "stocks":
    case "fii":
    case "bdr":
      return "B3";
    case "international_stocks":
    case "international_etf":
      return "US";
    case "etf":
      return ticker && !isBrazilianTicker(ticker.toUpperCase()) ? "US" : "B3";
    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Dates (ISO yyyy-mm-dd strings; UTC arithmetic on whole days)
// ---------------------------------------------------------------------------

const DAY_MS = 86_400_000;

function toIso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function fromIso(dateIso: string): number {
  return Date.parse(`${dateIso}T00:00:00Z`);
}

export function addDays(dateIso: string, days: number): string {
  return toIso(fromIso(dateIso) + days * DAY_MS);
}

function weekday(dateIso: string): number {
  return new Date(fromIso(dateIso)).getUTCDay();
}

/** The calendar date `instant` falls on in `timeZone`. */
export function localDate(timeZone: string, instant: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Offset (ms) of `timeZone` from UTC at `instant`: local wall time minus UTC. */
function zoneOffsetMs(timeZone: string, instant: number): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric" }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)!.value);
  return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - Math.floor(instant / 1000) * 1000;
}

/** The instant `dateIso` at hh:mm wall-clock time in `timeZone`. */
export function zonedInstant(timeZone: string, dateIso: string, hour: number, minute: number): Date {
  const wall = fromIso(dateIso) + (hour * 60 + minute) * 60_000;
  let guess = wall - zoneOffsetMs(timeZone, wall);
  // One correction covers a DST change between the guess and the answer.
  guess = wall - zoneOffsetMs(timeZone, guess);
  return new Date(guess);
}

// ---------------------------------------------------------------------------
// Holidays
// ---------------------------------------------------------------------------

/** Easter Sunday (Gregorian), the anchor for Carnival, Good Friday and Corpus Christi. */
function easter(year: number): string {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const md = (year: number, month: number, day: number) => `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

/** The n-th `dow` (0=Sunday) of a month; n=-1 is the last one. */
function nthWeekday(year: number, month: number, dow: number, n: number): string {
  if (n > 0) {
    const first = md(year, month, 1);
    const offset = (dow - weekday(first) + 7) % 7;
    return addDays(first, offset + (n - 1) * 7);
  }
  const last = addDays(md(month === 12 ? year + 1 : year, month === 12 ? 1 : month + 1, 1), -1);
  return addDays(last, -((weekday(last) - dow + 7) % 7));
}

/** NYSE observance: a Saturday holiday moves to Friday, a Sunday one to Monday. */
function observed(dateIso: string): string {
  const dow = weekday(dateIso);
  if (dow === 6) return addDays(dateIso, -1);
  if (dow === 0) return addDays(dateIso, 1);
  return dateIso;
}

function b3Holidays(year: number): string[] {
  const e = easter(year);
  return [
    md(year, 1, 1),
    addDays(e, -48), // Carnaval (segunda)
    addDays(e, -47), // Carnaval (terça)
    addDays(e, -2), // Sexta-feira Santa
    md(year, 4, 21),
    md(year, 5, 1),
    addDays(e, 60), // Corpus Christi
    md(year, 9, 7),
    md(year, 10, 12),
    md(year, 11, 2),
    md(year, 11, 15),
    ...(year >= 2024 ? [md(year, 11, 20)] : []), // Consciência Negra, national since 2024
    md(year, 12, 24), // B3 does not trade on Christmas Eve
    md(year, 12, 25),
    md(year, 12, 31), // nor on New Year's Eve
  ];
}

function usHolidays(year: number): string[] {
  const newYear = md(year, 1, 1);
  return [
    // New Year's Day on a Saturday is not observed on the Friday before (NYSE rule).
    ...(weekday(newYear) === 6 ? [] : [observed(newYear)]),
    nthWeekday(year, 1, 1, 3), // Martin Luther King Jr. Day
    nthWeekday(year, 2, 1, 3), // Washington's Birthday
    addDays(easter(year), -2), // Good Friday
    nthWeekday(year, 5, 1, -1), // Memorial Day
    ...(year >= 2022 ? [observed(md(year, 6, 19))] : []), // Juneteenth
    observed(md(year, 7, 4)),
    nthWeekday(year, 9, 1, 1), // Labor Day
    nthWeekday(year, 11, 4, 4), // Thanksgiving
    observed(md(year, 12, 25)),
  ];
}

const holidayCache = new Map<string, Set<string>>();

function holidaysFor(market: "B3" | "US", dateIso: string): Set<string> {
  const year = Number(dateIso.slice(0, 4));
  const key = `${market}:${year}`;
  let set = holidayCache.get(key);
  if (!set) {
    set = new Set(market === "B3" ? b3Holidays(year) : usHolidays(year));
    holidayCache.set(key, set);
  }
  return set;
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

/** Whether `dateIso` is a trading day. Every day is one for crypto. */
export function isSession(market: Market, dateIso: string): boolean {
  if (market === "CRYPTO") return true;
  const dow = weekday(dateIso);
  if (dow === 0 || dow === 6) return false;
  return !RULES[market].isHoliday(dateIso);
}

export function previousSession(market: Market, dateIso: string): string {
  let d = addDays(dateIso, -1);
  while (!isSession(market, d)) d = addDays(d, -1);
  return d;
}

/** The instant a session's close counts as available. Crypto has no close: the end of the UTC day. */
export function closeReadyAt(market: Market, dateIso: string): Date {
  if (market === "CRYPTO") return new Date(fromIso(dateIso) + DAY_MS);
  const rules = RULES[market];
  return zonedInstant(rules.timeZone, dateIso, rules.closeReady.hour, rules.closeReady.minute);
}

/** The trading date `instant` falls on, in the market's own time zone (UTC for crypto). */
export function marketDate(market: Market, instant: Date): string {
  return market === "CRYPTO" ? instant.toISOString().slice(0, 10) : localDate(RULES[market].timeZone, instant);
}

/**
 * The newest session whose close should exist by `now`: today once its
 * close is ready, else the session before. For crypto, yesterday (UTC):
 * a coin's "close" is just the price at the end of the UTC day.
 */
export function expectedLatestSession(market: Market, now: Date = new Date()): string {
  const today = marketDate(market, now);
  if (market === "CRYPTO") return addDays(today, -1);
  if (isSession(market, today) && now.getTime() >= closeReadyAt(market, today).getTime()) return today;
  return previousSession(market, today);
}

/**
 * An ok close for the session we should already have. An intraday row for
 * that date does not count: a refresh during the session must not make the
 * later close job skip the asset and keep the intraday price. A row counts
 * when its kind is "close", or when its own timestamp is already at or
 * after the session's close.
 */
export function okPriceForExpectedSession<T extends { date: Date; status: string; kind?: string | null; asOf?: Date | null }>(market: string, prices: readonly T[], now: Date): T | null {
  if (market !== "B3" && market !== "US" && market !== "CRYPTO") return null;
  const expected = expectedLatestSession(market, now);
  const readyAt = closeReadyAt(market, expected).getTime();
  return (
    prices.find((p) => {
      if (p.status !== "ok" || p.date.toISOString().slice(0, 10) !== expected) return false;
      if (p.kind === "close") return true;
      return !!p.asOf && p.asOf.getTime() >= readyAt;
    }) ?? null
  );
}

/** Sessions after `priceDate` up to and including `expected` — how many closes the price has missed. 0 when the price is that recent or newer. */
export function sessionsBehind(market: Market, priceDate: string, expected: string): number {
  let count = 0;
  for (let d = addDays(priceDate, 1); d <= expected; d = addDays(d, 1)) {
    if (isSession(market, d)) count++;
    // A price years old is simply stale; no need to count every day.
    if (count > 30) break;
  }
  return count;
}

/** Whether a quote for `dateIso` fetched at `fetchedAt` is that session's close (the market had closed) or an intraday price that a later close will replace. */
export function quoteKind(market: Market, dateIso: string, fetchedAt: Date): "close" | "intraday" {
  return fetchedAt.getTime() >= closeReadyAt(market, dateIso).getTime() ? "close" : "intraday";
}
