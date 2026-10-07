"use client";

import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import type { ViewConfig, ViewDataset } from "@capital/server/modules/ledger/contracts";
import type { SerializedView } from "@capital/server/modules/ledger/services/views";
import { useRouter } from "@/i18n/navigation";
import { api, apiDelete, apiPatch, apiPost, isUnauthenticated } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { announceWrite } from "@/lib/api/undo";
import { useAppMutation, useErrorMessage } from "@/lib/api/use-app-mutation";
import { buildTransactionsHref } from "./view-draft";
import { createViewSaver, insertView, patchView, removeView, type ViewSaver } from "./view-saver";

/** A ledger view as GET /v2/views returns it. */
export type LedgerView = Extract<SerializedView, { dataset: "ledger" }>;

export interface ViewPatch {
  name?: string;
  isFavorite?: boolean;
  /** The whole config (ledger: ViewConfig; Carteira: its dataset's config). */
  config?: ViewConfig | object;
}

/** What a views cache holds: GET /v2/views rows (any dataset). */
interface CachedView {
  id: string;
  config: unknown;
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

// ---------------------------------------------------------------------------
// The auto-save queue: one per dataset for the whole app (view-saver.ts)
// ---------------------------------------------------------------------------

interface SaverContext {
  queryClient: QueryClient;
  errorText: (error: unknown) => string;
}

interface SaverSlot {
  saver: ViewSaver<ViewPatch>;
  context: SaverContext | null;
}

const savers = new Map<ViewDataset, SaverSlot>();
let pageHideBound = false;

/** A reload or a closed tab inside the delay still saves: keepalive requests outlive the page. */
function bindPageHide() {
  if (pageHideBound || typeof window === "undefined") return;
  pageHideBound = true;
  window.addEventListener("pagehide", () => {
    for (const { saver } of savers.values()) {
      for (const [id, body] of saver.takePending()) {
        void api(`/api/v2/views/${id}`, { method: "PATCH", body: JSON.stringify(body), keepalive: true }).catch(() => undefined);
      }
    }
  });
}

function saverOf(dataset: ViewDataset): SaverSlot {
  const existing = savers.get(dataset);
  if (existing) return existing;
  const slot = { context: null } as SaverSlot;
  slot.saver = createViewSaver<ViewPatch, SerializedView & { batchId?: string | null }>({
    delay: VIEW_SAVE_DELAY,
    send: (id, body) => apiPatch(`/api/v2/views/${id}`, body),
    onSaved: (id, saved) => {
      const { batchId, ...view } = saved;
      // A read of the views that landed between the edit and this save showed the old view: put the saved one back.
      slot.context?.queryClient.setQueryData<CachedView[]>(keys.views(dataset), (list) => list?.map((item) => (item.id === id ? view : item)));
      // A rename or a favorite toggle is recorded: on the ⌘Z stack, silently.
      announceWrite(batchId ?? null, null);
    },
    onError: (_id, error) => {
      const context = slot.context;
      void context?.queryClient.invalidateQueries({ queryKey: keys.views(dataset) });
      if (context && !isUnauthenticated(error)) toast(context.errorText(error));
    },
  });
  savers.set(dataset, slot);
  bindPageHide();
  return slot;
}

/** The query client and error text the queue reports with (set by the mounted savers). */
function setSaverContext(dataset: ViewDataset, context: SaverContext): void {
  saverOf(dataset).context = context;
}

/** Forgets what is waiting to be saved for a view that is being deleted (any dataset), so no PATCH lands after the delete. */
export function dropViewSave(id: string): void {
  for (const { saver } of savers.values()) saver.drop(id);
}

/**
 * Auto-save of views, for any dataset: the change shows at once (the views
 * cache, which the tabs and the sidebar read, is updated in place), and
 * the PATCH goes out after VIEW_SAVE_DELAY, merged per view and one at a
 * time, so a quick series of edits lands in order and the last one wins
 * (view-saver.ts). One queue per dataset is shared by every screen, so
 * the tabs, the sidebar and Exibição never race each other, leaving a
 * screen inside the delay still saves, and a delete anywhere drops what is
 * waiting (dropViewSave). A failed save is toasted and the views are read
 * back from the server.
 */
export function useViewSaver(dataset: ViewDataset = "ledger") {
  const queryClient = useQueryClient();
  const errorText = useErrorMessage();
  useEffect(() => setSaverContext(dataset, { queryClient, errorText }), [dataset, queryClient, errorText]);

  return useCallback(
    (id: string, body: ViewPatch) => {
      void queryClient.cancelQueries({ queryKey: keys.views(dataset) });
      queryClient.setQueryData<CachedView[]>(keys.views(dataset), (list) => patchView(list, id, body));
      saverOf(dataset).saver.save(id, body);
    },
    [queryClient, dataset],
  );
}

// ---------------------------------------------------------------------------
// New view, and the view menu's actions (tabs, sidebar, ⌘K, Carteira)
// ---------------------------------------------------------------------------

/** Puts a created view in its list before anything reads it, so the screen opens it and not Todas while the list refetches. */
function useInsertView() {
  const queryClient = useQueryClient();
  return useCallback(
    (dataset: ViewDataset, view: CachedView) => {
      void queryClient.cancelQueries({ queryKey: keys.views(dataset) });
      queryClient.setQueryData<CachedView[]>(keys.views(dataset), (list) => insertView(list, view));
    },
    [queryClient],
  );
}

/**
 * Creates a blank view the server names ("Nova view", "Nova view 2"…) and
 * puts it in the cache. Its creation is not recorded (no batch), so it is
 * not on the ⌘Z stack: ⌘Z after its first filter does not delete it.
 */
export function useCreateView() {
  const insert = useInsertView();
  return useAppMutation({
    event: "views.write",
    mutationFn: async (input: { dataset: ViewDataset; config: object }) => {
      const { batchId, ...view } = await apiPost<SerializedView & { batchId?: string | null }>("/api/v2/views", { dataset: input.dataset, isFavorite: true, config: input.config });
      void batchId;
      return view as SerializedView;
    },
    onSuccess: (view, input) => insert(input.dataset, view),
  });
}

/**
 * "Nova view" (the tabs' "+", the sidebar's "+ Nova view" and ⌘K): a blank
 * favorite ledger view (useCreateView), opened on Transações with Exibição
 * open, where a new view starts.
 */
export function useNewView(onNavigate?: () => void) {
  const router = useRouter();
  const create = useCreateView();
  return {
    isPending: create.isPending,
    mutate: () =>
      create.mutate(
        { dataset: "ledger", config: {} },
        {
          onSuccess: (view) => {
            onNavigate?.();
            router.push(buildTransactionsHref({ viewId: view.id, display: true }));
          },
        },
      ),
  };
}

/**
 * Deletes a view of any dataset, undoably ("View “X” excluída · Desfazer";
 * undo brings it back under the same id): drops its pending auto-save
 * first and takes it out of the cache on success.
 */
export function useDeleteView() {
  const t = useTranslations("ledger.display");
  const queryClient = useQueryClient();
  return useAppMutation({
    event: "views.write",
    mutationFn: (view: { id: string; name: string; dataset: ViewDataset }) => {
      dropViewSave(view.id);
      return apiDelete<{ ok: true; batchId: string | null }>(`/api/v2/views/${view.id}`);
    },
    undo: (_data, view) => t("deleted", { name: view.name }),
    onSuccess: (_data, view) => {
      queryClient.setQueryData<CachedView[]>(keys.views(view.dataset), (list) => removeView(list, view.id));
    },
  });
}

/** "Duplicar" of any dataset: the copy ("<nome> (cópia)", with `config` or the stored one) goes in the cache. */
export function useDuplicateView() {
  const insert = useInsertView();
  return useAppMutation({
    event: "views.write",
    mutationFn: (input: { view: { id: string; dataset: ViewDataset }; config?: object }) =>
      apiPost<SerializedView & { batchId: string | null }>(`/api/v2/views/${input.view.id}/duplicate`, input.config ? { config: input.config } : {}),
    onSuccess: (copy, input) => {
      const { batchId, ...view } = copy;
      void batchId;
      insert(input.view.dataset, view);
    },
  });
}

/**
 * The view menu of a ledger view (tabs and sidebar): rename and favorite
 * auto-save, duplicate opens the copy, delete opens Todas when the deleted
 * view was on screen (`activeId`).
 */
export function useLedgerViewActions({ activeId, onNavigate }: { activeId: string | null; onNavigate?: () => void }) {
  const router = useRouter();
  const save = useViewSaver("ledger");
  const remove = useDeleteView();
  const duplicate = useDuplicateView();
  return {
    rename: (view: LedgerView, name: string) => {
      const next = name.trim();
      if (next && next !== view.name) save(view.id, { name: next });
    },
    toggleFavorite: (view: LedgerView) => save(view.id, { isFavorite: !view.isFavorite }),
    duplicate: (view: LedgerView) =>
      duplicate.mutate(
        { view },
        {
          onSuccess: (copy) => {
            onNavigate?.();
            router.push(buildTransactionsHref({ viewId: copy.id }));
          },
        },
      ),
    remove: (view: LedgerView) =>
      remove.mutate(view, {
        onSuccess: () => {
          if (view.id !== activeId) return;
          onNavigate?.();
          router.replace(buildTransactionsHref());
        },
      }),
  };
}
