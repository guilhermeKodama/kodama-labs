import type { DbClient } from "@capital/server/lib/prisma";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { compoundPercent, inflationPlus } from "@/lib/invest/dietz";
import { fetchSgs, SGS_SERIES, type BenchmarkSeries, type FetchLike } from "../lib/bcb";

/**
 * The CDI and IPCA series cached in MarketIndexValue (series "cdi" | "ipca",
 * value as the BCB publishes it, in percent) and the 12-month benchmarks the
 * portfolio summary shows next to "Rentab. 12m".
 */

const DAY = 86_400_000;
/** How far back an empty cache starts. */
const INITIAL_DAYS: Record<BenchmarkSeries, number> = { cdi: 2 * 366, ipca: 3 * 366 };
/** IPCA values may be revised: the last months are fetched again and overwritten. */
const IPCA_REFETCH_DAYS = 100;

export interface RefreshResult {
  series: BenchmarkSeries;
  fetched: number;
  stored: number;
  error?: string;
}

/**
 * Stored names of the series. Tests pass their own so they never touch the
 * shared cache (MarketIndexValue is global, not per user).
 */
export type SeriesNames = Record<BenchmarkSeries, string>;
const DEFAULT_NAMES: SeriesNames = { cdi: "cdi", ipca: "ipca" };

const utcDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

/**
 * Fetches what is missing since the last cached value (CDI) or the last
 * months again (IPCA) and stores it. A failing series does not stop the
 * other; its error is reported.
 */
export async function refreshBenchmarks(db: DbClient, opts: { fetchImpl?: FetchLike; now?: Date; names?: SeriesNames } = {}): Promise<RefreshResult[]> {
  const names = opts.names ?? DEFAULT_NAMES;
  const today = utcDay(opts.now ?? new Date());
  const results: RefreshResult[] = [];
  for (const series of Object.keys(SGS_SERIES) as BenchmarkSeries[]) {
    const name = names[series];
    try {
      const last = await db.marketIndexValue.findFirst({ where: { series: name }, orderBy: { date: "desc" }, select: { date: true } });
      const from = !last
        ? new Date(today.getTime() - INITIAL_DAYS[series] * DAY)
        : series === "ipca"
          ? new Date(last.date.getTime() - IPCA_REFETCH_DAYS * DAY)
          : new Date(utcDay(last.date).getTime() + DAY);
      if (from > today) {
        results.push({ series, fetched: 0, stored: 0 });
        continue;
      }
      const values = await fetchSgs(SGS_SERIES[series], from, today, opts.fetchImpl);
      let stored = 0;
      if (series === "cdi") {
        stored = (await db.marketIndexValue.createMany({ data: values.map((v) => ({ series: name, date: v.date, value: v.value })), skipDuplicates: true })).count;
      } else {
        for (const v of values) {
          await db.marketIndexValue.upsert({ where: { series_date: { series: name, date: v.date } }, create: { series: name, date: v.date, value: v.value }, update: { value: v.value } });
          stored++;
        }
      }
      results.push({ series, fetched: values.length, stored });
    } catch (error) {
      results.push({ series, fetched: 0, stored: 0, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return results;
}

export interface Benchmarks12m {
  /** CDI accumulated over the 12 months up to asOf (fraction), or null without enough data. */
  cdi: number | null;
  /** IPCA of the last 12 published months (fraction), or null. */
  ipca: number | null;
  /** IPCA 12m + 6% a year. */
  ipcaPlus6: number | null;
  /** Last CDI day used and last IPCA month used ("YYYY-MM-DD"). */
  cdiAsOf: string | null;
  ipcaAsOf: string | null;
}

/** About 21 business days a month: below this the CDI window has gaps. */
const MIN_CDI_DAYS = 230;

/** The 12-month benchmarks ending at `asOf`, from the cache only. */
export async function benchmarks12m(db: DbClient, asOf: Date = new Date(), names: SeriesNames = DEFAULT_NAMES): Promise<Benchmarks12m> {
  const end = utcDay(asOf);
  const start = new Date(Date.UTC(end.getUTCFullYear() - 1, end.getUTCMonth(), end.getUTCDate()));
  const [cdiRows, ipcaRows] = await Promise.all([
    db.marketIndexValue.findMany({ where: { series: names.cdi, date: { gt: start, lte: end } }, orderBy: { date: "asc" }, select: { date: true, value: true } }),
    db.marketIndexValue.findMany({ where: { series: names.ipca, date: { lte: end } }, orderBy: { date: "desc" }, take: 12, select: { date: true, value: true } }),
  ]);
  const cdi = cdiRows.length >= MIN_CDI_DAYS ? compoundPercent(cdiRows.map((r) => toNumber(r.value))) : null;
  const ipca = ipcaRows.length === 12 ? compoundPercent(ipcaRows.map((r) => toNumber(r.value))) : null;
  return {
    cdi,
    ipca,
    ipcaPlus6: ipca === null ? null : inflationPlus(ipca, 0.06),
    cdiAsOf: cdiRows.length ? cdiRows[cdiRows.length - 1].date.toISOString().slice(0, 10) : null,
    ipcaAsOf: ipcaRows.length ? ipcaRows[0].date.toISOString().slice(0, 10) : null,
  };
}
