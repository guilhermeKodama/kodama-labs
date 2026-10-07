/**
 * The auto-save queue of saved views (any dataset), without React: the
 * hook in use-views.ts puts the change in the views cache at once and hands
 * the PATCH to this queue.
 *
 * - Debounced: a PATCH goes out `delay` ms after the last edit.
 * - Merged per view: the edits made inside the delay become one body (the
 *   last value of each field wins; `config` is always the whole config).
 * - Serialized: one PATCH at a time, in edit order, so two quick edits
 *   never race on the server.
 * - Latest wins: a saved answer is handed back (`onSaved`) only when no
 *   newer edit of that view came after it, so a slow answer never puts an
 *   older config back on screen.
 * - Dropped on delete: `drop(id)` forgets what is waiting for a deleted
 *   view, skips it if it is already queued, and marks a PATCH already sent
 *   as dropped so its 404 is not reported.
 */

export interface ViewSaverDeps<Body, Saved> {
  send: (id: string, body: Body) => Promise<Saved>;
  /** The server's answer, when no newer edit of the view came after it. */
  onSaved?: (id: string, saved: Saved) => void;
  /** A failed save of a view that was not dropped. */
  onError?: (id: string, error: unknown) => void;
  delay: number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface ViewSaver<Body> {
  /** Queues an edit of a view (merged with what is waiting for it). */
  save(id: string, body: Body): void;
  /** Forgets a view (deleted): nothing more is sent for it, and the error of a PATCH in flight is ignored. */
  drop(id: string): void;
  /** Whether `drop(id)` was called after the view's last edit. */
  isDropped(id: string): boolean;
  /** Sends what is waiting now; resolves when every queued PATCH has settled. */
  flush(): Promise<void>;
  /** What is waiting (and clears it): for keepalive requests when the page goes away. */
  takePending(): [string, Body][];
  /** Whether an edit is waiting for the delay. */
  waiting(): boolean;
}

export function createViewSaver<Body extends object, Saved>(deps: ViewSaverDeps<Body, Saved>): ViewSaver<Body> {
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  const pending = new Map<string, Body>();
  /** Edits per view so far (a drop counts as one). */
  const edits = new Map<string, number>();
  const dropped = new Set<string>();
  let timer: unknown = null;
  let chain: Promise<void> = Promise.resolve();

  const bump = (id: string) => {
    const next = (edits.get(id) ?? 0) + 1;
    edits.set(id, next);
    return next;
  };
  const cancelTimer = () => {
    if (timer !== null) clearTimer(timer);
    timer = null;
  };

  const flush = () => {
    cancelTimer();
    const batch = [...pending.entries()].map(([id, body]) => ({ id, body, edit: edits.get(id) ?? 0 }));
    pending.clear();
    if (batch.length) {
      chain = chain.then(async () => {
        for (const { id, body, edit } of batch) {
          if (dropped.has(id)) continue;
          try {
            const saved = await deps.send(id, body);
            if ((edits.get(id) ?? 0) === edit) deps.onSaved?.(id, saved);
          } catch (error) {
            if (!dropped.has(id)) deps.onError?.(id, error);
          }
        }
      });
    }
    return chain;
  };

  return {
    save(id, body) {
      dropped.delete(id);
      pending.set(id, { ...pending.get(id), ...body });
      bump(id);
      cancelTimer();
      timer = setTimer(() => {
        timer = null;
        void flush();
      }, deps.delay);
    },
    drop(id) {
      pending.delete(id);
      dropped.add(id);
      bump(id);
      if (!pending.size) cancelTimer();
    },
    isDropped: (id) => dropped.has(id),
    flush,
    takePending() {
      cancelTimer();
      const entries = [...pending.entries()];
      pending.clear();
      return entries;
    },
    waiting: () => timer !== null,
  };
}

/** A view inserted in a cached list (at the end), unless it is there already. */
export function insertView<V extends { id: string }>(list: readonly V[] | undefined, view: V): V[] | undefined {
  if (!list) return list;
  return list.some((item) => item.id === view.id) ? (list as V[]) : [...list, view];
}

/** A cached list without a view. */
export function removeView<V extends { id: string }>(list: readonly V[] | undefined, id: string): V[] | undefined {
  return list?.filter((item) => item.id !== id);
}

/** A cached view with an edit applied (the optimistic part of a save; `config` replaces the whole config). */
export function patchView<V extends { id: string; config: unknown }>(list: readonly V[] | undefined, id: string, body: { name?: string; isFavorite?: boolean; config?: unknown }): V[] | undefined {
  return list?.map((view) => (view.id === id ? { ...view, ...body, config: body.config ?? view.config } : view));
}
