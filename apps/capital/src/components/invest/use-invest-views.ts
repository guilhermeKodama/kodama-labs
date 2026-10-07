"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { DEFAULT_HOLDINGS_CONFIG, normalizeHoldingsConfig, type HoldingsViewConfig } from "@/lib/invest/holdings-view";
import { INCOME_12M_CONFIG, normalizeOpsConfig, OPERATIONS_CONFIG, type OpsViewConfig } from "@/lib/invest/ops-view";
import { useCreateView, useDeleteView, useDuplicateView, useViewSaver, type ViewPatch } from "@/lib/ledger/use-views";

export type InvestDataset = "holdings" | "investment_ops";

interface StoredView {
  id: string;
  name: string;
  dataset: string;
  seedKey?: string | null;
  config: unknown;
}

/** A Carteira tab: a saved view of positions or of operations. */
export type InvestView =
  | { id: string; name: string; seedKey: string | null; persisted: boolean; dataset: "holdings"; config: HoldingsViewConfig }
  | { id: string; name: string; seedKey: string | null; persisted: boolean; dataset: "investment_ops"; config: OpsViewConfig };

function listOf(dataset: InvestDataset) {
  return { queryKey: keys.views(dataset), queryFn: () => apiGet<StoredView[]>("/api/v2/views", { dataset }) };
}

/**
 * The Carteira tabs: the user's holdings views, then the operations views
 * (seeded at first access: Por classe, Por corretora, Por entidade, Lista,
 * Proventos 12m, Operações). Only when reading a dataset's views fails are
 * its default tabs shown read-only (persisted: false), so the screen still
 * works; a user who deleted every view sees no tabs, and "+" adds one.
 */
export function useInvestViews() {
  const t = useTranslations("invest.portfolio.tabs");
  const holdings = useQuery(listOf("holdings"));
  const ops = useQuery(listOf("investment_ops"));
  const views = useMemo<InvestView[]>(() => {
    const holdingsView = (seedKey: string, groupBy: HoldingsViewConfig["groupBy"]): InvestView => ({
      id: `seed:${seedKey}`,
      name: t(seedKey),
      seedKey,
      persisted: false,
      dataset: "holdings",
      config: { ...DEFAULT_HOLDINGS_CONFIG, groupBy },
    });
    const holdingsViews: InvestView[] = holdings.isError
      ? [holdingsView("byClass", "allocationClass"), holdingsView("byBroker", "accountId"), holdingsView("byEntity", "entityId"), holdingsView("list", "none")]
      : (holdings.data ?? [])
          .filter((v) => v.dataset === "holdings")
          .map((v) => ({ id: v.id, name: v.name, seedKey: v.seedKey ?? null, persisted: true, dataset: "holdings" as const, config: normalizeHoldingsConfig(v.config) }));
    const opsViews: InvestView[] = ops.isError
      ? [
          { id: "seed:income12m", name: t("income12m"), seedKey: "income12m", persisted: false, dataset: "investment_ops", config: INCOME_12M_CONFIG },
          { id: "seed:operations", name: t("operations"), seedKey: "operations", persisted: false, dataset: "investment_ops", config: OPERATIONS_CONFIG },
        ]
      : (ops.data ?? [])
          .filter((v) => v.dataset === "investment_ops")
          .map((v) => ({ id: v.id, name: v.name, seedKey: v.seedKey ?? null, persisted: true, dataset: "investment_ops" as const, config: normalizeOpsConfig(v.config) }));
    return [...holdingsViews, ...opsViews];
  }, [holdings.data, ops.data, holdings.isError, ops.isError, t]);
  return { views, isLoading: holdings.isLoading || ops.isLoading, canCreate: holdings.isSuccess && ops.isSuccess };
}

/** Finds the tab of ?view= (an id or seed:<key>), else the first one. */
export function pickView(views: readonly InvestView[], param: string | null): InvestView | null {
  if (!views.length) return null;
  if (param) {
    const byId = views.find((v) => v.id === param);
    if (byId) return byId;
    if (param.startsWith("seed:")) {
      const bySeed = views.find((v) => v.seedKey === param.slice(5));
      if (bySeed) return bySeed;
    }
  }
  return views[0];
}

/**
 * Writes to the Carteira views, through the same auto-save queue as the
 * ledger's (useViewSaver: shown at once, debounced, one PATCH at a time,
 * latest wins), so quick filter clicks never race the refetch. Create
 * (named "Nova view N" by the server), duplicate and delete (undoable)
 * keep the views cache up to date before anything reads it.
 */
export function useInvestViewWrites() {
  const saveHoldings = useViewSaver("holdings");
  const saveOps = useViewSaver("investment_ops");
  const create = useCreateView();
  const duplicate = useDuplicateView();
  const remove = useDeleteView();
  return {
    update: (view: InvestView, patch: ViewPatch) => {
      if (!view.persisted) return;
      (view.dataset === "holdings" ? saveHoldings : saveOps)(view.id, patch);
    },
    create,
    duplicate,
    remove,
  };
}

export type InvestViewWrites = ReturnType<typeof useInvestViewWrites>;
