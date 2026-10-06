/**
 * Portfolio return ("Rentab. 12m"): chain-linked Modified Dietz over monthly
 * values. Pure and dependency-free: the server's portfolio summary and
 * history import it, and so can the client.
 *
 * For one month, with V0 the value at the start, V1 the value at the end
 * and F the net external flow during the month (money put in minus money
 * taken out), Modified Dietz assumes the flow happened mid-month:
 *
 *   r = (V1 − V0 − F) / (V0 + ½·F)
 *
 * Months are then chain-linked: (1 + r1)(1 + r2)… − 1, which removes the
 * effect of the size and timing of contributions across months.
 */

export interface DietzPeriod {
  startValue: number;
  endValue: number;
  netFlow: number;
}

/** A capital base this small (in money units) has no meaningful return. */
const MIN_BASE = 0.005;

/**
 * Return of one period, or null when there is no capital to measure it on
 * (nothing at the start and nothing, or more taken out than put in, during
 * the month). `weight` is the share of the period the flow was invested
 * (½ = mid-period).
 */
export function modifiedDietz(p: DietzPeriod, weight = 0.5): number | null {
  const base = p.startValue + weight * p.netFlow;
  if (!(base > MIN_BASE)) return null;
  return (p.endValue - p.startValue - p.netFlow) / base;
}

/** (1 + r1)(1 + r2)… − 1; an empty list is 0. */
export function chainLink(returns: readonly number[]): number {
  return returns.reduce((acc, r) => acc * (1 + r), 1) - 1;
}

/** Compounds rates given in percent (as the BCB publishes them): 0.04 means 0.04%. */
export function compoundPercent(ratesPercent: readonly number[]): number {
  return chainLink(ratesPercent.map((r) => r / 100));
}

/** IPCA + a real rate: (1 + ipca)(1 + real) − 1, for the period the IPCA covers. */
export function inflationPlus(ipca: number, realRate: number): number {
  return (1 + ipca) * (1 + realRate) - 1;
}

/** A month of the portfolio history, oldest first and consecutive. */
export interface MonthValue {
  /** "YYYY-MM" */
  period: string;
  /** Value at the end of the month (holdings + broker cash). */
  value: number;
  /** Net external flow during the month. */
  netFlow: number;
  /** The value is an estimate (cost basis instead of market prices). */
  estimated?: boolean;
}

export interface TrailingReturn {
  /** Chain-linked return over the months that could be measured, or null when none could. */
  value: number | null;
  /** Months that entered the chain (at most `window`). */
  months: number;
  /** First and last month of the chain ("YYYY-MM"). */
  from: string | null;
  to: string | null;
  /** Each month of the window: its return, or null when it was left out. */
  monthly: { period: string; return: number | null }[];
}

/**
 * Chain-linked Modified Dietz over the last `window` months of `series`
 * (the month before the window gives the first start value). With
 * `skipEstimated` (the default) a month whose start or end value is an
 * estimate is left out, so cost-basis estimates never pass for market
 * returns; a month with no capital base is left out too.
 */
export function trailingReturn(series: readonly MonthValue[], opts: { window?: number; skipEstimated?: boolean } = {}): TrailingReturn {
  const window = opts.window ?? 12;
  const skipEstimated = opts.skipEstimated ?? true;
  const start = Math.max(1, series.length - window);
  const monthly: TrailingReturn["monthly"] = [];
  const kept: number[] = [];
  let from: string | null = null;
  let to: string | null = null;
  for (let i = start; i < series.length; i++) {
    const prev = series[i - 1];
    const cur = series[i];
    const r = skipEstimated && (prev.estimated || cur.estimated) ? null : modifiedDietz({ startValue: prev.value, endValue: cur.value, netFlow: cur.netFlow });
    monthly.push({ period: cur.period, return: r });
    if (r === null) continue;
    kept.push(r);
    from ??= cur.period;
    to = cur.period;
  }
  return { value: kept.length ? chainLink(kept) : null, months: kept.length, from, to, monthly };
}
