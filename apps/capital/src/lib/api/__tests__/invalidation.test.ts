import { describe, expect, it, vi } from "vitest";
import { invalidateEvent, invalidationPrefixes, MUTATION_EVENTS, type MutationEvent } from "@/lib/api/invalidation";
import { keys, QUERY_ROOTS, type QueryRoot } from "@/lib/api/keys";

const roots = (event: MutationEvent | MutationEvent[]) => invalidationPrefixes(event).map(([root]) => root);

/** One sample key per factory, so every factory is checked against the roots. */
const SAMPLE_KEYS: readonly (readonly unknown[])[] = [
  keys.me(),
  keys.entities(),
  keys.accounts({ includeArchived: true }),
  keys.statements("acc1"),
  keys.categories({ withCounts: true }),
  keys.categoryUsage("cat1"),
  keys.currencies(),
  keys.rules(),
  keys.ruleTest("ifood"),
  keys.views("holdings"),
  keys.ledgerQuery({ period: { preset: "this_month" } }),
  keys.entry("e1"),
  keys.entryHistory("e1"),
  keys.deleteOptions("e1"),
  keys.attachments("ledger_entry", "e1"),
  keys.mutations({ undoable: true, limit: 1 }),
  keys.trash(),
  keys.budgets({ mode: "month", m: "2026-09", scope: "all" }),
  keys.budgetsList(),
  keys.recurring(),
  keys.holdings("pf"),
  keys.operations({ type: "dividend" }),
  keys.portfolioSummary("pj"),
  keys.portfolioHistory({ months: 12 }),
  keys.targets(),
  keys.rebalance({ amount: 1000 }),
  keys.contributions({ end: "2026-09" }),
  keys.fire(),
  keys.quotes(["VALE3", "PETR4"]),
  keys.assetSearch("petr"),
  keys.imports(),
  keys.importAnalyze("nubank.ofx:1234"),
  keys.notificationsSettings(),
  keys.devices("https://push.example/1"),
  keys.apiTokens(),
  keys.apiClients(),
  keys.assistantConversations(),
  keys.assistantConversation("c1"),
];

describe("keys", () => {
  it("starts every key with a known root", () => {
    for (const key of SAMPLE_KEYS) expect(QUERY_ROOTS).toContain(key[0]);
  });

  it("covers every root with some factory", () => {
    expect(new Set(SAMPLE_KEYS.map((key) => key[0]))).toEqual(new Set(QUERY_ROOTS));
  });

  it("keeps entry details under the ledger root, so ledger writes refresh them", () => {
    expect(keys.entry("e1").slice(0, 3)).toEqual(["ledger", "entry", "e1"]);
    expect(keys.entryHistory("e1").slice(0, 3)).toEqual(keys.entry("e1"));
    expect(keys.deleteOptions("e1").slice(0, 3)).toEqual(keys.entry("e1"));
  });

  it("sorts quote tickers without touching the caller's array", () => {
    const tickers = ["VALE3", "PETR4"];
    expect(keys.quotes(tickers)).toEqual(["quotes", ["PETR4", "VALE3"]]);
    expect(tickers).toEqual(["VALE3", "PETR4"]);
  });
});

describe("invalidationPrefixes", () => {
  it("refreshes everything ledger-derived after a ledger write", () => {
    expect(roots("ledger.write")).toEqual(
      expect.arrayContaining(["ledger", "accounts", "statements", "budgets", "recurring", "contributions", "portfolio", "rebalance", "fire", "trash", "mutations"]),
    );
    expect(roots("ledger.write")).not.toContain("views");
    expect(roots("ledger.write")).not.toContain("me");
  });

  it("refreshes only the session after a preferences change", () => {
    expect(roots("me.write")).toEqual(["me"]);
  });

  it("refreshes after an undo what a ledger write does, plus saved views, entities and the session (all in the undo registry)", () => {
    expect(new Set(roots("undo"))).toEqual(new Set([...roots("ledger.write"), "views", "me", "entities"]));
  });

  it("keeps domain writes scoped", () => {
    expect(roots("views.write")).toEqual(["views"]);
    expect(roots("budgets.write")).toEqual(["budgets", "mutations"]);
    expect(roots("notifications.write")).toEqual(["notifications"]);
    expect(roots("tokens.write")).toEqual(["tokens"]);
    expect(roots("investments.write")).toEqual(expect.arrayContaining(["holdings", "operations", "portfolio", "targets", "rebalance", "contributions", "fire"]));
    expect(roots("imports.write")).toEqual(expect.arrayContaining(["imports", "views", "ledger", "rules"]));
    expect(roots("catalog.write")).toEqual(expect.arrayContaining(["me", "entities", "accounts", "categories", "currencies", "rules", "ledger"]));
    expect(roots("settings.write")).toEqual(expect.arrayContaining(["me", "currencies", "ledger", "portfolio"]));
  });

  it("merges several events without duplicates", () => {
    const merged = roots(["views.write", "ledger.write"]);
    expect(merged).toContain("views");
    expect(merged).toContain("ledger");
    expect(new Set(merged).size).toBe(merged.length);
  });

  it("invalidates every root except market data through some event", () => {
    const covered = new Set<QueryRoot>(MUTATION_EVENTS.flatMap((event) => roots(event)));
    const uncovered = QUERY_ROOTS.filter((root) => !covered.has(root));
    expect(uncovered.sort()).toEqual(["assets", "quotes"]);
  });

  it("only names known roots", () => {
    for (const event of MUTATION_EVENTS) for (const root of roots(event)) expect(QUERY_ROOTS).toContain(root);
  });
});

describe("invalidateEvent", () => {
  it("invalidates each prefix once", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    await invalidateEvent({ invalidateQueries }, "budgets.write");
    expect(invalidateQueries.mock.calls).toEqual([[{ queryKey: ["budgets"] }], [{ queryKey: ["mutations"] }]]);
  });
});
