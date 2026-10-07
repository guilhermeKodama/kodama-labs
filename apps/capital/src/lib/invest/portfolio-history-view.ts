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
