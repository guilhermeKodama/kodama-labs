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
  /** Edits per view so far: a saved answer is written back only when no newer edit of that view came after it. */
  const edits = useRef(new Map<string, number>());
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
    const batch = [...pending.current.entries()].map(([id, body]) => ({ id, body, edit: edits.current.get(id) ?? 0 }));
    pending.current.clear();
    if (!batch.length) return;
    chain.current = chain.current.then(async () => {
      for (const { id, body, edit } of batch) {
        try {
          const saved = await mutateAsync({ id, body });
          // A read of the views that landed between the edit and this save showed the old view: put the saved one back.
          if ((edits.current.get(id) ?? 0) === edit) {
            queryClient.setQueryData<LedgerView[]>(keys.views("ledger"), (list) => list?.map((view) => (view.id === id ? saved : view)));
          }
        } catch {
          // Toasted by useAppMutation; the views are refetched.
        }
      }
    });
  }, [mutateAsync, queryClient]);

  const save = useCallback(
    (id: string, body: ViewPatch) => {
      void queryClient.cancelQueries({ queryKey: keys.views("ledger") });
      queryClient.setQueryData<LedgerView[]>(keys.views("ledger"), (list) => list?.map((view) => (view.id === id ? { ...view, ...body, config: body.config ?? view.config } : view)));
      pending.current.set(id, { ...pending.current.get(id), ...body });
      edits.current.set(id, (edits.current.get(id) ?? 0) + 1);
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

  // A reload or a closed tab inside the delay still saves: keepalive requests outlive the page.
  useEffect(() => {
    const onPageHide = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      for (const [id, body] of pending.current) {
        void api(`/api/v2/views/${id}`, { method: "PATCH", body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
      }
      pending.current.clear();
    };
    window.addEventListener("pagehide", onPageHide);
    return () => window.removeEventListener("pagehide", onPageHide);
  }, []);

  return save;
}
