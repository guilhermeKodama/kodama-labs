/**
 * How many Alpha Vantage HTTP calls this process may still make today.
 * The free tier allows 25 a day. 22 leaves a few for a manual retry after
 * the close. The counter is one row per UTC day; the next day is a new row.
 *
 * The suite does not count. A shared row would let one file spend the day
 * for every other file. Production (VITEST unset) always counts, and a
 * test that sets ALPHA_VANTAGE_ENFORCE_BUDGET=1 counts too.
 */

export const ALPHA_VANTAGE_DAILY_CAP = 22;

export function alphaVantageBudgetEnforced(): boolean {
  if (process.env.ALPHA_VANTAGE_ENFORCE_BUDGET === "1") return true;
  if (process.env.VITEST) return false;
  return true;
}

/** UTC calendar day, yyyy-mm-dd. A date, not a timestamp, so the session time zone cannot shift it. */
export function alphaVantageCallDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export function msUntilUtcMidnight(now: Date): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(0, next - now.getTime());
}

export type AlphaVantageReservation = { ok: true; calls: number } | { ok: false; retryAfterMs: number };

/**
 * Reserves one call for `now`'s UTC day, or refuses once the day is full.
 * The insert-or-increment is one statement, so two callers cannot both
 * pass a cap that only one of them still had room for.
 */
export async function reserveAlphaVantageCall(now: Date = new Date()): Promise<AlphaVantageReservation> {
  if (!alphaVantageBudgetEnforced()) return { ok: true, calls: 0 };
  const { prisma } = await import("@capital/server/lib/prisma");
  const day = alphaVantageCallDay(now);
  const rows = await prisma.$queryRaw<{ calls: number }[]>`
    INSERT INTO alpha_vantage_call_days (day, calls)
    VALUES (CAST(${day} AS date), 1)
    ON CONFLICT (day) DO UPDATE
    SET calls = alpha_vantage_call_days.calls + 1
    WHERE alpha_vantage_call_days.calls < ${ALPHA_VANTAGE_DAILY_CAP}
    RETURNING calls
  `;
  const calls = rows[0] ? Number(rows[0].calls) : undefined;
  if (calls === undefined || !Number.isFinite(calls)) return { ok: false, retryAfterMs: msUntilUtcMidnight(now) };
  return { ok: true, calls };
}
