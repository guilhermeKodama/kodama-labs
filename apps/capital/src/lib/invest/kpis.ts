/**
 * What the investment KPIs show when the number alone would mislead:
 * "Taxa de poupança" above 100% and "Rentab. 12m" with no measured month.
 */

/**
 * "Taxa de poupança" (PF aportes ÷ PF Entradas): shown up to 100%. Aportes
 * above the PF income of the window (money that came from savings, a sale or
 * another entity) show 100% and say so (`capped`) instead of a rate like
 * 96.312%. Aportes are net of resgates, so the rate goes negative when more
 * came out of the brokers than went in (`negative`: "resgates maiores que
 * aportes").
 */
export function savingsRateKpi(rate: number | null | undefined): { value: number | null; capped: boolean; negative: boolean } {
  if (rate === null || rate === undefined || !Number.isFinite(rate)) return { value: null, capped: false, negative: false };
  if (rate > 1) return { value: 1, capped: true, negative: false };
  return { value: rate, capped: false, negative: rate < 0 };
}

export type ReturnKpiState = "value" | "estimated" | "pending";

/**
 * "Rentab. 12m": the chained return when some month could be measured;
 * "estimated" when every month of the window is an estimate (valued at
 * cost, backfilled before snapshots existed), so "—" reads "histórico
 * estimado"; "pending" when there is no closed month yet.
 */
export function return12mState(ret: { value: number | null; estimated?: boolean } | null | undefined): ReturnKpiState {
  if (ret?.value !== null && ret?.value !== undefined) return "value";
  return ret?.estimated ? "estimated" : "pending";
}
