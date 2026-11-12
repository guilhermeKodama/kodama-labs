/**
 * "Patrimônio vs total aportado" (Carteira): the "Aportado" area is split
 * into the aportes and the "posições iniciais" (holdings registered without
 * operations, server lib/portfolio-timeline.ts), stacked so their top is
 * still "Total aportado". A position typed in when the user started shows
 * as a posição inicial in the month it was typed, never as an aporte.
 */
import type { HistoryMonth } from "./types";

export interface NetWorthChartRow {
  period: string;
  netWorth: number;
  /** "Total aportado" without the posições iniciais. */
  aportes: number;
  initial: number;
}

export function netWorthChartRows(months: readonly Pick<HistoryMonth, "period" | "netWorth" | "contributed" | "initialPositions">[]): { rows: NetWorthChartRow[]; hasInitial: boolean } {
  const rows = months.map((m) => {
    const initial = m.initialPositions ?? 0;
    return { period: m.period, netWorth: m.netWorth, aportes: Math.round((m.contributed - initial) * 100) / 100, initial };
  });
  return { rows, hasInitial: rows.some((r) => Math.abs(r.initial) >= 0.005) };
}

export type NetWorthTooltipKey = "initial" | "aportes" | "netWorth" | "capitalInvested";

export interface NetWorthTooltipRow {
  key: NetWorthTooltipKey;
  /** Same scale as the chart point (thousands, after the chart has scaled it). */
  value: number;
  /** Capital investido is initial + aportes, the height of the aportes stroke. Not its own series. */
  derived: boolean;
}

/**
 * Tooltip rows in stack order, bottom to top: posições iniciais, the aportes
 * band, then patrimônio. When the opening book is on the chart, a last row
 * names capital investido (initial + aportes). That is where the aportes
 * stroke sits — below the dashed line when net aportes are negative — and
 * it is not a fourth series.
 */
export function netWorthTooltipRows(
  point: { netWorth: number; aportes: number; initial: number },
  showInitial: boolean,
): NetWorthTooltipRow[] {
  const rows: NetWorthTooltipRow[] = [];
  if (showInitial) rows.push({ key: "initial", value: point.initial, derived: false });
  rows.push({ key: "aportes", value: point.aportes, derived: false });
  rows.push({ key: "netWorth", value: point.netWorth, derived: false });
  if (showInitial) {
    rows.push({
      key: "capitalInvested",
      value: Math.round((point.initial + point.aportes) * 10) / 10,
      derived: true,
    });
  }
  return rows;
}
