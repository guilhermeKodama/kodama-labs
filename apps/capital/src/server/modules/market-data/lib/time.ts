/** Normalizes a provider's own timestamp shape (epoch seconds/ms, ISO string, Date) to a full ISO instant, or null when absent/invalid. Shared by the provider adapters and quotes.ts, which still shows a precise "as of" time that AssetPrice's date-only granularity doesn't need. */
export function isoOrNull(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (typeof value === "number") return new Date(value > 1e12 ? value : value * 1000).toISOString();
  if (typeof value === "string" && value) {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  return null;
}
