"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { apiGet } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import {
  investTabs,
  type InvestDataset,
  type InvestView,
  type StoredInvestView,
} from "@/lib/invest/invest-tabs";
import {
  useCreateView,
  useDeleteView,
  useDuplicateView,
  useViewSaver,
  type ViewPatch,
} from "@/lib/ledger/use-views";

export type { InvestDataset, InvestView };

function listOf(dataset: InvestDataset) {
  return {
    queryKey: keys.views(dataset),
    queryFn: () => apiGet<StoredInvestView[]>("/api/v2/views", { dataset }),
  };
}

/**
 * The Carteira tabs: the user's holdings views, then the operations views
 * (seeded at first access: Por classe, Por corretora, Por entidade, Lista,
 * Proventos 12m, Operações), as stored (investTabs): a user who deleted
 * every view sees no tabs, and "+" adds one. Only a failed read shows the
 * default tabs, read-only, so the screen still works.
 */
export function useInvestViews() {
  const t = useTranslations("invest.portfolio.tabs");
  const holdings = useQuery(listOf("holdings"));
  const ops = useQuery(listOf("investment_ops"));
  const views = useMemo<InvestView[]>(
    () =>
      investTabs(
        { data: holdings.data, isError: holdings.isError },
        { data: ops.data, isError: ops.isError },
        (key) => t(key),
      ),
    [holdings.data, ops.data, holdings.isError, ops.isError, t],
  );
  // "+" needs both lists read (a refetch that fails later keeps them).
  return {
    views,
    isLoading: holdings.isLoading || ops.isLoading,
    canCreate: holdings.data !== undefined && ops.data !== undefined,
  };
}

/** Finds the tab of ?view= (an id or seed:<key>), else the first one. */
export function pickView(
  views: readonly InvestView[],
  param: string | null,
): InvestView | null {
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
