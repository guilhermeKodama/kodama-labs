import type { QueryClient } from "@tanstack/react-query";
import type { QueryRoot } from "./keys";

/**
 * What each kind of write makes stale. Mutations name an event
 * (useAppMutation({ event })) instead of listing query keys, so a new
 * screen that reads, say, contributions is refreshed by every write that
 * can change them without touching the writers.
 */
export const MUTATION_EVENTS = [
  "ledger.write",
  "views.write",
  "catalog.write",
  "budgets.write",
  "recurring.write",
  "investments.write",
  "imports.write",
  "settings.write",
  "me.write",
  "notifications.write",
  "tokens.write",
  "assistant.write",
  "undo",
] as const;

export type MutationEvent = (typeof MUTATION_EVENTS)[number];

/**
 * Everything computed from ledger entries. Entries carry balances (accounts,
 * card statements), budget spending, recurring occurrences, broker cash
 * (portfolio, rebalance), aportes (contributions, FIRE), linked investment
 * operations, category/rule/import counts, the trash and the undo history.
 */
const LEDGER_DERIVED: readonly QueryRoot[] = [
  "ledger",
  "attachments",
  "accounts",
  "statements",
  "budgets",
  "recurring",
  "holdings",
  "operations",
  "portfolio",
  "rebalance",
  "contributions",
  "fire",
  "categories",
  "rules",
  "imports",
  "trash",
  "mutations",
];

const EVENT_ROOTS: Record<MutationEvent, readonly QueryRoot[]> = {
  "ledger.write": LEDGER_DERIVED,
  "views.write": ["views"],
  // Entities, accounts, categories, rules, currencies: names and options
  // everywhere, and merges/reassignments rewrite entries.
  "catalog.write": ["me", "entities", "currencies", ...LEDGER_DERIVED],
  "budgets.write": ["budgets", "mutations"],
  // Creating or paying a rule books entries.
  "recurring.write": LEDGER_DERIVED,
  // Operations write cash legs; targets drive the rebalance.
  "investments.write": ["targets", ...LEDGER_DERIVED],
  // Imports book entries, learn rules and create the import's view.
  "imports.write": ["views", ...LEDGER_DERIVED],
  // Base currency, timezone and FX rates change how amounts and periods are computed.
  "settings.write": ["me", "entities", "currencies", "targets", ...LEDGER_DERIVED],
  // Name, theme, language, display formats: only the session.
  "me.write": ["me"],
  "notifications.write": ["notifications"],
  "tokens.write": ["tokens"],
  "assistant.write": ["assistant"],
  // An undone batch can hold any model of the undo registry (saved views and entities included).
  undo: ["views", "entities", ...LEDGER_DERIVED],
};

/** Query-key prefixes to invalidate after `event`, without duplicates. */
export function invalidationPrefixes(event: MutationEvent | readonly MutationEvent[]): (readonly [QueryRoot])[] {
  const events: readonly MutationEvent[] = typeof event === "string" ? [event] : event;
  const roots = new Set(events.flatMap((name) => EVENT_ROOTS[name]));
  return [...roots].map((root) => [root] as const);
}

/** Marks the event's queries stale; mounted ones refetch. Resolves when they are back. */
export function invalidateEvent(queryClient: Pick<QueryClient, "invalidateQueries">, event: MutationEvent | readonly MutationEvent[]): Promise<unknown> {
  return Promise.all(invalidationPrefixes(event).map((queryKey) => queryClient.invalidateQueries({ queryKey })));
}
