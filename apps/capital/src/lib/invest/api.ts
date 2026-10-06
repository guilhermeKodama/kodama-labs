"use client";

/**
 * Investment queries (Carteira, Aportes, operation dialog). Writes go
 * through useAppMutation({ event: "investments.write" }) in the screens.
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { apiGet, apiPost } from "@/lib/api/client";
import { useCurrencies } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import type {
  AssetSearchResponse,
  ContributionsResponse,
  FireSummaryResponse,
  Holding,
  Operation,
  PortfolioHistory,
  PortfolioScope,
  PortfolioSummary,
  PortfolioTargetRow,
  RebalanceSuggestion,
} from "./types";

export function usePortfolioSummary(scope: PortfolioScope) {
  return useQuery({
    queryKey: keys.portfolioSummary(scope),
    queryFn: () => apiGet<PortfolioSummary>("/api/v2/portfolio/summary", { scope }),
    placeholderData: keepPreviousData,
  });
}

export function usePortfolioHistory(scope: PortfolioScope, months = 12) {
  return useQuery({
    queryKey: keys.portfolioHistory({ months, scope }),
    queryFn: () => apiGet<PortfolioHistory>("/api/v2/portfolio/history", { months, scope }),
    placeholderData: keepPreviousData,
  });
}

export function useHoldings(scope: PortfolioScope) {
  return useQuery({
    queryKey: keys.holdings(scope),
    queryFn: async () => (await apiGet<{ holdings: Holding[] }>("/api/v2/holdings", { scope })).holdings,
    placeholderData: keepPreviousData,
  });
}

export interface OperationsParams {
  scope?: PortfolioScope;
  holdingId?: string;
  type?: string;
  from?: string;
  to?: string;
  limit?: number;
}

export function useOperations(params: OperationsParams, enabled = true) {
  return useQuery({
    queryKey: keys.operations({ ...params }),
    enabled,
    queryFn: async () => (await apiGet<{ operations: Operation[]; total: number }>("/api/v2/investment-operations", { ...params })).operations,
    placeholderData: keepPreviousData,
  });
}

export function useTargets() {
  return useQuery({
    queryKey: keys.targets(),
    queryFn: async () => (await apiGet<{ targets: PortfolioTargetRow[] }>("/api/v2/portfolio/targets")).targets,
  });
}

export function useRebalance(amount: number, scope: PortfolioScope) {
  return useQuery({
    queryKey: keys.rebalance({ amount, mode: "asset", scope }),
    enabled: amount > 0,
    retry: false,
    queryFn: () => apiPost<RebalanceSuggestion>("/api/v2/portfolio/rebalance-suggestion", { amount, mode: "asset", scope }),
    placeholderData: keepPreviousData,
  });
}

export function useContributions(end: string, scope: PortfolioScope, months = 12) {
  return useQuery({
    queryKey: keys.contributions({ end, scope, months }),
    queryFn: () => apiGet<ContributionsResponse>("/api/v2/contributions", { end, scope, months }),
    placeholderData: keepPreviousData,
  });
}

export function useFireSummary(altContribution: number | null) {
  return useQuery({
    queryKey: keys.fire({ summary: true, altContribution }),
    queryFn: () => apiGet<FireSummaryResponse>("/api/v1/fire/summary", { altContribution }),
    placeholderData: keepPreviousData,
  });
}

export function useAssetSearch(query: string, remote: boolean, enabled = true) {
  const q = query.trim();
  return useQuery({
    queryKey: [...keys.assetSearch(q), { remote }],
    enabled: enabled && q.length > 0,
    staleTime: 60_000,
    queryFn: () => apiGet<AssetSearchResponse>("/api/v2/assets/search", { q, limit: 4, remote }),
    placeholderData: keepPreviousData,
  });
}

/** `value` once it has stayed the same for `delay` ms (typing in amount and search inputs). */
export function useDebounced<T>(value: T, delay = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return settled;
}

/**
 * Base-currency units per unit of `currency` (manualRate is units of the
 * currency per base unit, so its inverse), and the rates the screen shows.
 */
export function useFxRates() {
  const currencies = useCurrencies();
  return useMemo(() => {
    const base = currencies.data?.baseCurrency ?? "BRL";
    const rates = new Map<string, number>([[base, 1]]);
    for (const c of currencies.data?.currencies ?? []) if (c.code !== base && c.manualRate > 0) rates.set(c.code, 1 / c.manualRate);
    const rateFor = (currency: string | null | undefined) => (currency ? (rates.get(currency.toUpperCase()) ?? 1) : 1);
    return { base, rates, rateFor };
  }, [currencies.data]);
}
