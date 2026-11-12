/**
 * Runs `fn` over `items` with at most `limit` in flight, preserving order.
 * Shared by every integration that fans out one HTTP call per item (brapi's
 * Free plan prices one ticker per request; market-data's sync-prices does
 * the same per-asset fallback) instead of each rolling its own.
 */
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!);
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}
