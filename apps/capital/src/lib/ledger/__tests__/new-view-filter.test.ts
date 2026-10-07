import { describe, expect, it } from "vitest";
import { isViewParamPending, resolveActiveView, viewListSettled } from "@/lib/ledger/view-draft";
import { createViewSaver, insertView } from "@/lib/ledger/view-saver";
import { planViewUpdate } from "@/lib/ledger/view-update";
import { viewConfig } from "./fixtures";

/**
 * Create a view → add a filter → the filter is saved in that view. The
 * "+" used to open ?view=<new id> before the view was in the list: the
 * screen fell back to Todas, whose filters stay in the draft, so the
 * filter was never saved.
 */
const todas = { id: "all", isBuiltin: true, seedKey: null, config: viewConfig() };
const mercado = { id: "v1", isBuiltin: false, seedKey: null, config: viewConfig() };
const created = { id: "v-new", isBuiltin: false, seedKey: null, config: viewConfig() };
const outflows = [{ field: "flowKind" as const, op: "in" as const, values: ["out"] }];

describe("a new view's first filter", () => {
  it("waits for the new view instead of showing Todas while the list does not have it yet", () => {
    const list = [todas, mercado];
    // Refetching (or not loaded): wait.
    expect(isViewParamPending(list, created.id, false)).toBe(true);
    // Settled without it (a deleted view, an old link): Todas.
    expect(isViewParamPending(list, created.id, true)).toBe(false);
    expect(resolveActiveView(list, created.id)?.id).toBe("all");
    // Ids in the list, seed keys and no param are never pending.
    expect(isViewParamPending(list, mercado.id, false)).toBe(false);
    expect(isViewParamPending(list, "seed:ir", false)).toBe(false);
    expect(isViewParamPending(list, null, false)).toBe(false);
  });

  it("stops waiting once the list has answered, also with an error (no endless Carregando…)", () => {
    expect(viewListSettled({ status: "pending", fetchStatus: "fetching" })).toBe(false);
    expect(viewListSettled({ status: "success", fetchStatus: "fetching" })).toBe(false);
    expect(viewListSettled({ status: "success", fetchStatus: "idle" })).toBe(true);
    // A failed first read or refetch: the screen shows the error (or Todas), not "Carregando…" for good.
    expect(viewListSettled({ status: "error", fetchStatus: "idle" })).toBe(true);
    expect(isViewParamPending([], created.id, viewListSettled({ status: "error", fetchStatus: "idle" }))).toBe(false);
  });

  it("opens the created view once it is in the cache, and PATCHes the filter into its config", async () => {
    const list = insertView([todas, mercado], created)!;
    expect(isViewParamPending(list, created.id, false)).toBe(false);
    const active = resolveActiveView(list, created.id)!;
    expect(active.id).toBe(created.id);

    const plan = planViewUpdate({ saved: active.config, draft: null, isBuiltin: active.isBuiltin, patch: { filters: outflows } });
    expect(plan.draft).toBeNull();

    const sent: { id: string; body: { config?: unknown } }[] = [];
    const timer: { fn: (() => void) | null } = { fn: null };
    const saver = createViewSaver<{ config?: unknown }, unknown>({
      delay: 250,
      setTimer: (fn) => (timer.fn = fn),
      clearTimer: () => (timer.fn = null),
      send: async (id, body) => {
        sent.push({ id, body });
        return {};
      },
    });
    if (plan.save) saver.save(active.id, { config: plan.save });
    timer.fn?.();
    await saver.flush();
    expect(sent).toEqual([{ id: created.id, body: { config: { ...created.config, filters: outflows } } }]);
  });

  it("on Todas (where the screen used to fall back) the same filter is only a draft", () => {
    const plan = planViewUpdate({ saved: todas.config, draft: null, isBuiltin: true, patch: { filters: outflows } });
    expect(plan.save).toBeNull();
    expect(plan.draft).toEqual({ filters: outflows });
  });
});
