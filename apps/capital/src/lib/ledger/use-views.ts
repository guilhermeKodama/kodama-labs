"use client";

import { useCallback, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { ViewConfig } from "@capital/server/modules/ledger/contracts";
import type { SerializedView } from "@capital/server/modules/ledger/services/views";
import { api, apiPatch } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";

/** A ledger view as GET /v2/views returns it. */
export type LedgerView = Extract<SerializedView, { dataset: "ledger" }>;

export interface ViewPatch {
  name?: string;
  isFavorite?: boolean;
  config?: ViewConfig;
}

/** The user's ledger views (Todas and the defaults are created on first access). Same cache as the sidebar. */
export function useLedgerViews() {
  return useQuery({
    queryKey: keys.views("ledger"),
    queryFn: () => api<LedgerView[]>("/api/v2/views?dataset=ledger"),
  });
}

/** Debounce of the auto-save (mockup viewSave=auto). */
export const VIEW_SAVE_DELAY = 250;

/**
 * Auto-save of views: the change shows at once (the views cache, which the
 * tabs and the sidebar read, is updated in place), and the PATCH goes out
 * after VIEW_SAVE_DELAY, merged per view and one at a time, so a quick
 * series of edits lands in order and the last one wins. A failed save is
 * toasted and the views are read back from the server.
 */
export function useViewSaver() {
  const queryClient = useQueryClient();
  const pending = useRef(new Map<string, ViewPatch>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const patch = useAppMutation({
    event: null,
    mutationFn: ({ id, body }: { id: string; body: ViewPatch }) => apiPatch<LedgerView>(`/api/v2/views/${id}`, body),
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: keys.views("ledger") });
    },
  });
  const mutateAsync = patch.mutateAsync;

  const flush = useCallback(() => {
    timer.current = null;
    const batch = [...pending.current.entries()];
    pending.current.clear();
    if (!batch.length) return;
    chain.current = chain.current.then(async () => {
      for (const [id, body] of batch) {
        try {
          await mutateAsync({ id, body });
        } catch {
          // Toasted by useAppMutation; the views are refetched.
        }
      }
    });
  }, [mutateAsync]);

  const save = useCallback(
    (id: string, body: ViewPatch) => {
      void queryClient.cancelQueries({ queryKey: keys.views("ledger") });
      queryClient.setQueryData<LedgerView[]>(keys.views("ledger"), (list) => list?.map((view) => (view.id === id ? { ...view, ...body, config: body.config ?? view.config } : view)));
      pending.current.set(id, { ...pending.current.get(id), ...body });
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, VIEW_SAVE_DELAY);
    },
    [queryClient, flush],
  );

  // Leaving the screen saves what is still waiting.
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        flush();
      }
    },
    [flush],
  );

  return save;
}
