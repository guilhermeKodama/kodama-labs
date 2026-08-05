export function formatBRL(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

// Whole-real currency for tight spots (funnel stage cards): R$ 1.266
export function formatBRLWhole(cents: number | null | undefined): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    maximumFractionDigits: 0,
  }).format(Math.round(cents / 100));
}

export function formatPct(fraction: number | null | undefined, digits = 1): string {
  if (fraction == null) return "—";
  return `${(fraction * 100).toFixed(digits).replace(".", ",")}%`;
}

export function formatInt(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("pt-BR").format(value);
}

export function formatMetricValue(
  value: number | null,
  unit: "cents" | "ratio",
): string {
  if (value == null) return "—";
  return unit === "cents" ? formatBRL(Math.round(value)) : formatPct(value);
}

export function hoursAgo(date: Date | null): number | null {
  if (!date) return null;
  return Math.floor((Date.now() - date.getTime()) / 3_600_000);
}
