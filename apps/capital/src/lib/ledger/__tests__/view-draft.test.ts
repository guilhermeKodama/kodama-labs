import { describe, expect, it } from "vitest";
import type { ViewConfig } from "@capital/server/modules/ledger/contracts";
import {
  applyViewDraft,
  buildTransactionsHref,
  canonicalViewParam,
  cleanViewDraft,
  decodeViewDraft,
  diffViewConfig,
  encodeViewDraft,
  isDirty,
  parseViewParam,
  resolveActiveView,
  saveAsNewView,
  type ViewDraft,
} from "@/lib/ledger/view-draft";

const saved: ViewConfig = {
  layout: "table",
  period: { preset: "this_month", offset: 0 },
  dateField: "date",
  filters: [],
  groupBy: [],
  sort: [{ field: "date", dir: "desc" }],
  columns: ["date", "description", "amountBase"],
  calcs: { amountBase: "sum" },
  chart: { type: "bar", metric: "sum", cumulative: false, top: 0 },
  transferDisplay: "group",
};

const drill: ViewDraft = {
  filters: [{ field: "categoryId", op: "in", values: ["cat-mercado"] }],
  period: { from: "2026-09-01", to: "2026-09-30" },
  label: "Mercado · set/2026",
};

describe("view draft codec", () => {
  it("round-trips through a URL-safe string", () => {
    const param = encodeViewDraft(drill)!;
    expect(param).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeViewDraft(param)).toEqual(drill);
  });

  it("keeps accents and symbols", () => {
    const draft: ViewDraft = { search: "pão de açúcar ✓", label: "Saídas · “set”" };
    expect(decodeViewDraft(encodeViewDraft(draft))).toEqual(draft);
  });

  it("has no param for an empty draft", () => {
    expect(encodeViewDraft({})).toBeNull();
    expect(encodeViewDraft(null)).toBeNull();
    expect(encodeViewDraft({ search: undefined })).toBeNull();
  });

  it("ignores unreadable params", () => {
    expect(decodeViewDraft(null)).toBeNull();
    expect(decodeViewDraft("")).toBeNull();
    expect(decodeViewDraft("%%%")).toBeNull();
    expect(decodeViewDraft(btoa("not json"))).toBeNull();
    expect(decodeViewDraft(btoa(JSON.stringify([1, 2])))).toBeNull();
    expect(decodeViewDraft(btoa(JSON.stringify({ evil: true })))).toBeNull();
  });

  it("drops unknown keys and wrong shapes", () => {
    expect(cleanViewDraft({ layout: "chart", filters: "x", groupBy: [], period: 3, __proto__x: 1, label: "" })).toEqual({ layout: "chart", groupBy: [] });
  });
});

describe("applying and comparing drafts", () => {
  it("puts the draft over the saved config, label aside", () => {
    const config = applyViewDraft(saved, drill);
    expect(config.filters).toEqual(drill.filters);
    expect(config.period).toEqual(drill.period);
    expect(config.columns).toEqual(saved.columns);
    expect("label" in config).toBe(false);
    expect(applyViewDraft(saved, null)).toEqual(saved);
  });

  it("is dirty only when the draft changes something", () => {
    expect(isDirty(saved, null)).toBe(false);
    expect(isDirty(saved, { label: "só rótulo" })).toBe(false);
    expect(isDirty(saved, { layout: "table", sort: [{ dir: "desc", field: "date" }] })).toBe(false);
    expect(isDirty(saved, drill)).toBe(true);
    expect(isDirty(saved, { chart: { ...saved.chart, top: 8 } })).toBe(true);
  });

  it("diffs two configs into the smallest draft", () => {
    expect(diffViewConfig(saved, saved)).toEqual({});
    const next = { ...saved, layout: "pivot" as const, groupBy: [{ field: "categoryId" as const }] };
    expect(diffViewConfig(saved, next)).toEqual({ layout: "pivot", groupBy: [{ field: "categoryId" }] });
    expect(applyViewDraft(saved, diffViewConfig(saved, next))).toEqual(next);
  });

  it("saves a draft as a new view", () => {
    expect(saveAsNewView(saved, drill, "Mercado em setembro")).toEqual({
      name: "Mercado em setembro",
      dataset: "ledger",
      isFavorite: true,
      config: applyViewDraft(saved, drill),
    });
  });
});

describe("view param and links", () => {
  it("reads view ids and seeded keys", () => {
    expect(parseViewParam("abc123")).toEqual({ viewId: "abc123" });
    expect(parseViewParam("seed:ir")).toEqual({ seedKey: "ir" });
    expect(parseViewParam("seed:")).toBeNull();
    expect(parseViewParam(null)).toBeNull();
  });

  it("builds /transactions links in a fixed parameter order", () => {
    expect(buildTransactionsHref()).toBe("/transactions");
    expect(buildTransactionsHref({ seedKey: "ir" })).toBe("/transactions?view=seed%3Air");
    expect(buildTransactionsHref({ viewId: "v1", seedKey: "ir", entry: "e1" })).toBe("/transactions?view=v1&entry=e1");
    expect(buildTransactionsHref({ create: {} })).toBe("/transactions?create=1");
    expect(buildTransactionsHref({ viewId: "v1", display: true, import: true, trash: true, q: "uber" })).toBe(
      "/transactions?view=v1&q=uber&display=1&import=1&trash=1",
    );
  });

  it("carries the draft and the quick-add draft so the screen reads them back", () => {
    const href = buildTransactionsHref({ viewId: "v1", draft: drill, create: { description: "iFood", amount: 86.9 } });
    const params = new URL(href, "http://x").searchParams;
    expect(decodeViewDraft(params.get("draft"))).toEqual(drill);
    expect(JSON.parse(params.get("create")!)).toEqual({ description: "iFood", amount: 86.9 });
  });
});

describe("resolving ?view", () => {
  const views = [
    { id: "v-subs", seedKey: "subs", isBuiltin: false },
    { id: "v-all", seedKey: null, isBuiltin: true },
    { id: "v-mine", seedKey: null, isBuiltin: false },
  ];

  it("picks the view by id or seed key, else Todas, else the first", () => {
    expect(resolveActiveView(views, "v-mine")?.id).toBe("v-mine");
    expect(resolveActiveView(views, "seed:subs")?.id).toBe("v-subs");
    expect(resolveActiveView(views, null)?.id).toBe("v-all");
    expect(resolveActiveView(views, "gone")?.id).toBe("v-all");
    expect(resolveActiveView(views, "seed:pj")?.id).toBe("v-all");
    expect(resolveActiveView([views[2]!], "seed:pj")?.id).toBe("v-mine");
    expect(resolveActiveView([], "seed:ir")).toBeNull();
  });

  it("rewrites a seed key to the view id, or drops it when that view does not exist", () => {
    expect(canonicalViewParam(views, "seed:subs", true)).toBe("v-subs");
    expect(canonicalViewParam(views, "seed:pj", true)).toBeNull();
  });

  it("leaves the param alone while loading, for plain ids and without a param", () => {
    expect(canonicalViewParam([], "seed:subs", false)).toBeUndefined();
    expect(canonicalViewParam(views, "just-created", true)).toBeUndefined();
    expect(canonicalViewParam(views, null, true)).toBeUndefined();
    expect(canonicalViewParam(views, "seed:", true)).toBeUndefined();
  });
});
