"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";
import { parseAsString, useQueryState } from "nuqs";
import { useFmt } from "@/lib/format/provider";
import { compactAmount } from "@/lib/invest/contributions-view";
import { isPortfolioScope, type PortfolioScope } from "@/lib/invest/types";

/** ?scope= of the investment screens (Consolidado, PF, PJ). */
export function useScopeParam(): [PortfolioScope, (scope: PortfolioScope) => void] {
  const [raw, setRaw] = useQueryState("scope", parseAsString);
  const scope: PortfolioScope = isPortfolioScope(raw) ? raw : "all";
  const set = useCallback((next: PortfolioScope) => void setRaw(next === "all" ? null : next), [setRaw]);
  return [scope, set];
}

/** "set/26" from "YYYY-MM" (mockup month labels). */
export function useMonthShort(): (period: string) => string {
  const fmt = useFmt();
  const t = useTranslations("invest");
  return useCallback(
    (period: string) => t("monthShort", { month: fmt.monthAbbr(Number(period.slice(5, 7))), year: period.slice(2, 4) }),
    [fmt, t],
  );
}

/** "out/25–set/26" for a window of "YYYY-MM" months. */
export function useMonthRange(): (from: string, to: string) => string {
  const short = useMonthShort();
  return useCallback((from: string, to: string) => (from === to ? short(to) : `${short(from)}–${short(to)}`), [short]);
}

/** "R$ 4,2 mi" (compact money, mockup FIRE block). */
export function useCompactMoney(): (value: number, currency?: string | null) => string {
  const fmt = useFmt();
  const t = useTranslations("invest.compact");
  return useCallback(
    (value: number, currency?: string | null) => {
      const { value: number, unit } = compactAmount(value, (n, digits) => fmt.number(n, digits));
      return t(unit ?? "none", { symbol: fmt.currencySymbol(currency), value: number });
    },
    [fmt, t],
  );
}

/** "+14,8%" / "−4,2%" (signed percentage, U+2212 minus). */
export function useSignedPct(): (value: number, digits?: number) => string {
  const fmt = useFmt();
  return useCallback((value: number, digits = 1) => `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmt.pct(Math.abs(value), digits)}`, [fmt]);
}

/** Today as "YYYY-MM-DD" in the user's timezone. */
export function todayIn(timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

export const MONO = "font-mono tabular-nums";
