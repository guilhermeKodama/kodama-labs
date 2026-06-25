// Calendar-day helpers. Ads platforms and GA4 report whole days in the
// account/property timezone, so "which day is it" must always be asked in the
// idea's timezone — never the server's.

export function dayInTz(timezone: string, offsetDays = 0, from = new Date()): string {
  const shifted = new Date(from.getTime() + offsetDays * 86_400_000);
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(shifted);
}

// "YYYY-MM-DD" → Date at UTC midnight (what Prisma stores for @db.Date)
export function dateKey(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

export function* eachDay(sinceDay: string, untilDay: string): Generator<string> {
  let cursor = dateKey(sinceDay);
  const end = dateKey(untilDay);
  while (cursor <= end) {
    yield cursor.toISOString().slice(0, 10);
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
}

// Where a daily-ingest should start pulling from, as "YYYY-MM-DD":
//  - first sight of an idea/channel (no rows yet) → backfill the full history
//    from ads_launched_at (or a long lookback if the launch date is unknown);
//  - afterwards → stay incremental, re-pulling only a short trailing overlap so
//    the platforms' restatements (attribution windows, invalid-click cleanup,
//    GA4 reprocessing) overwrite the last few days. `forceDays`, when given,
//    overrides both with a fixed N-day window (manual re-backfill via ?days=).
export function ingestSince(
  latestStored: Date | null,
  opts: {
    adsLaunchedAt: Date | null;
    timezone: string;
    overlapDays: number;
    backfillLookbackDays: number;
    forceDays?: number;
  },
): string {
  if (opts.forceDays != null) return dayInTz(opts.timezone, -opts.forceDays);
  if (latestStored) {
    const d = new Date(latestStored.getTime() - opts.overlapDays * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (opts.adsLaunchedAt) return opts.adsLaunchedAt.toISOString().slice(0, 10);
  return dayInTz(opts.timezone, -opts.backfillLookbackDays);
}
