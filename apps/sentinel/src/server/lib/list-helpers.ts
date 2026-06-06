import { unstable_cache } from "next/cache";
import { prisma } from "./prisma";

const APPROX_COUNT_TTL_SECONDS = 300;
const FILTER_OPTIONS_TTL_SECONDS = 3600;

const approximateRowCountUncached = async (tableName: string): Promise<number> => {
  const rows = await prisma.$queryRawUnsafe<{ reltuples: number }[]>(
    `SELECT GREATEST(reltuples, 0)::float8 AS reltuples FROM pg_class WHERE relname = $1 AND relkind = 'r' LIMIT 1`,
    tableName,
  );
  const reltuples = rows[0]?.reltuples ?? 0;
  return Math.round(reltuples);
};

const cachedApproxRowCount = unstable_cache(
  approximateRowCountUncached,
  ["approximate-row-count-v1"],
  { revalidate: APPROX_COUNT_TTL_SECONDS },
);

export const approximateRowCount = (tableName: string) => cachedApproxRowCount(tableName);

interface CountOptions {
  tableName: string;
  where: Record<string, unknown>;
  approxThreshold?: number;
  exactCount: () => Promise<number>;
}

/**
 * For unfiltered queries, use pg_class.reltuples as an approximate count —
 * exact COUNT(*) is O(rows) and is the main reason listing pages are slow on
 * large tables. When any filter is applied we fall back to the exact count
 * (cheap because the filter is indexed).
 */
export const smartCount = async ({
  tableName,
  where,
  approxThreshold = 5000,
  exactCount,
}: CountOptions): Promise<number> => {
  if (Object.keys(where).length === 0) {
    const approx = await approximateRowCount(tableName);
    if (approx > approxThreshold) return approx;
  }

  return exactCount();
};

export const cachedFilterOptions = <T>(
  key: string,
  loader: () => Promise<T>,
  revalidate: number = FILTER_OPTIONS_TTL_SECONDS,
): Promise<T> => {
  const cached = unstable_cache(loader, [`filter-options-${key}-v1`], { revalidate });
  return cached();
};

/**
 * Alias of {@link cachedFilterOptions} for non-filter aggregations (e.g. the
 * network page's full-table shareholder GROUP BY). Same impl, friendlier
 * call-site reading.
 */
export const cachedAggregation = cachedFilterOptions;
