"use client";

import { useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiDelete, apiGet, apiPatch, apiPost } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { DEFAULT_HOLDINGS_CONFIG, normalizeHoldingsConfig, type HoldingsViewConfig } from "@/lib/invest/holdings-view";
import { INCOME_12M_CONFIG, normalizeOpsConfig, OPERATIONS_CONFIG, type OpsViewConfig } from "@/lib/invest/ops-view";

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
 * Proventos 12m, Operações). Until the server seeds them, the same six are
 * shown read-only (persisted: false) so the screen works; their display
 * cannot be edited then.
 */
export function useInvestViews() {
  const t = useTranslations("invest.portfolio.tabs");
  const holdings = useQuery(listOf("holdings"));
  const ops = useQuery(listOf("investment_ops"));
  const views = useMemo<InvestView[]>(() => {
    const stored: InvestView[] = [
      ...(holdings.data ?? []).filter((v) => v.dataset === "holdings").map((v) => ({ id: v.id, name: v.name, seedKey: v.seedKey ?? null, persisted: true, dataset: "holdings" as const, config: normalizeHoldingsConfig(v.config) })),
      ...(ops.data ?? []).filter((v) => v.dataset === "investment_ops").map((v) => ({ id: v.id, name: v.name, seedKey: v.seedKey ?? null, persisted: true, dataset: "investment_ops" as const, config: normalizeOpsConfig(v.config) })),
    ];
    if (stored.length || holdings.isLoading || ops.isLoading) return stored;
    const holdingsView = (seedKey: string, groupBy: HoldingsViewConfig["groupBy"]): InvestView => ({
      id: `seed:${seedKey}`,
      name: t(seedKey),
      seedKey,
      persisted: false,
      dataset: "holdings",
      config: { ...DEFAULT_HOLDINGS_CONFIG, groupBy },
    });
    return [
      holdingsView("byClass", "allocationClass"),
      holdingsView("byBroker", "accountId"),
      holdingsView("byEntity", "entityId"),
      holdingsView("list", "none"),
      { id: "seed:income12m", name: t("income12m"), seedKey: "income12m", persisted: false, dataset: "investment_ops", config: INCOME_12M_CONFIG },
      { id: "seed:operations", name: t("operations"), seedKey: "operations", persisted: false, dataset: "investment_ops", config: OPERATIONS_CONFIG },
    ];
  }, [holdings.data, ops.data, holdings.isLoading, ops.isLoading, t]);
  return { views, isLoading: holdings.isLoading || ops.isLoading };
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

/** Writes to the Carteira views: config and name changes are applied to the cache at once, then saved. */
export function useInvestViewWrites() {
  const queryClient = useQueryClient();
  const t = useTranslations("invest.portfolio.display");
  const patchCache = (dataset: InvestDataset, id: string, patch: Partial<StoredView>) =>
    queryClient.setQueryData<StoredView[]>(keys.views(dataset), (list) => list?.map((v) => (v.id === id ? { ...v, ...patch } : v)));
  const update = useAppMutation({
    event: "views.write",
    mutationFn: ({ view, patch }: { view: InvestView; patch: { config?: unknown; name?: string } }) => apiPatch<StoredView>(`/api/v2/views/${view.id}`, patch),
    onMutate: ({ view, patch }) => patchCache(view.dataset, view.id, patch),
  });
  const create = useAppMutation({
    event: "views.write",
    mutationFn: ({ dataset, name, config }: { dataset: InvestDataset; name: string; config: unknown }) => apiPost<StoredView>("/api/v2/views", { dataset, name, isFavorite: true, config }),
  });
  const remove = useAppMutation({
    event: "views.write",
    mutationFn: (view: InvestView) => apiDelete(`/api/v2/views/${view.id}`),
    undo: (_data, view) => t("deleted", { name: view.name }),
  });
  return { update, create, remove };
}
