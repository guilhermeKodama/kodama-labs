import { buildTransactionsHref, type TransactionsHrefOptions } from "@/lib/ledger/view-draft";
import type { QuickAddCatalog, QuickAddDraft, QuickAddResult } from "@/lib/ledger/quick-add";
import { TRANSACTIONS_PATH } from "./shortcuts";

/**
 * Where ⌘K's commands lead. Pure, so the URLs are tested apart from the
 * palette.
 */

/** Ajustes' pages, in the order of its menu (mockup SETTINGS_NAV); the `page` param of /settings. */
export const SETTINGS_PAGES = ["prefs", "notif", "ent", "bank", "card", "broker", "cat", "rules", "fx", "imports", "api"] as const;
export type SettingsPage = (typeof SETTINGS_PAGES)[number];

export function settingsHref(page?: SettingsPage | null): string {
  return page ? `/settings?page=${page}` : "/settings";
}

/** The overlays of Transações, opened through its URL (components/ledger/overlay-state.ts). */
const LEDGER_OVERLAY_PARAMS = ["entry", "create", "import", "trash", "display"] as const;

export type LedgerTarget = Pick<TransactionsHrefOptions, "entry" | "create" | "import" | "trash" | "q">;

/**
 * A link that opens something of Transações (an entry, the create dialog,
 * the import dialog, the trash, a search). On Transações it keeps what is
 * on screen, the view and its draft, and only swaps the open overlay;
 * from any other screen it goes to Transações' default view.
 */
export function ledgerHref(location: { pathname: string; search: string }, target: LedgerTarget): string {
  if (location.pathname !== TRANSACTIONS_PATH) return buildTransactionsHref(target);
  const current = new URLSearchParams(location.search);
  for (const name of LEDGER_OVERLAY_PARAMS) current.delete(name);
  // The same builder encodes the new params, so the codecs stay in one place.
  const added = new URL(buildTransactionsHref(target), "http://local").searchParams;
  for (const [name, value] of added) current.set(name, value);
  const query = current.toString();
  return query ? `${TRANSACTIONS_PATH}?${query}` : TRANSACTIONS_PATH;
}

/** Shortest text that searches Lançamentos from ⌘K. */
export const SEARCH_MIN_LENGTH = 2;

/**
 * The ⌘K search over Lançamentos (C5): display rows, no totals, every
 * date, a few rows. Debounced by the palette.
 */
export function transactionSearchQuery(text: string, limit = 8) {
  return {
    semantics: "display" as const,
    skipTotals: true,
    search: text.trim(),
    period: { preset: "all" as const },
    includeRows: true,
    page: { limit },
  };
}

/** The text looks like a transaction ("ifood 86,90 nubank ontem"): ⌘K offers to create it. */
export function isQuickAdd(result: QuickAddResult): boolean {
  return typeof result.draft.amount === "number" && result.draft.amount > 0;
}

/** Chips under the quick-add command, as in the create form (mockup 4834-4840): the fields found, in reading order. */
export type QuickAddChipField = "description" | "amount" | "kind" | "account" | "entity" | "date" | "category" | "currency";

export function quickAddChipFields(draft: QuickAddDraft): QuickAddChipField[] {
  const fields: QuickAddChipField[] = [];
  if (draft.description) fields.push("description");
  if (draft.amount !== undefined) fields.push("amount");
  // Saída is the default: only a "+" (Entrada) or another kind is worth a chip.
  if (draft.kind && draft.kind !== "expense") fields.push("kind");
  if (draft.accountId) fields.push("account");
  if (draft.entityId) fields.push("entity");
  if (draft.date) fields.push("date");
  if (draft.categoryId || draft.categoryName) fields.push("category");
  if (draft.currency) fields.push("currency");
  return fields;
}

/**
 * The user's "today" (YYYY-MM-DD) in their timezone, the base of "hoje"
 * and "ontem" in quick add. An unknown timezone falls back to UTC.
 */
export function todayIn(timezone: string, now: Date = new Date()): string {
  const format = (timeZone: string) =>
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).reduce<Record<string, string>>((acc, part) => {
      acc[part.type] = part.value;
      return acc;
    }, {});
  let parts: Record<string, string>;
  try {
    parts = format(timezone);
  } catch {
    parts = format("UTC");
  }
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * What quick add matches names against, from the catalog queries: archived
 * accounts, entities and categories left out; the currency codes the user
 * has (the base one included).
 */
export function quickAddCatalog(source: {
  accounts: readonly { id: string; name: string; entityId: string; type: string; currency: string; archivedAt?: string | null }[];
  entities: readonly { id: string; name: string; kind: "personal" | "business"; archivedAt?: string | null }[];
  categories: readonly { id: string; name: string; type: string; isArchived?: boolean }[];
  currencies: readonly string[];
  baseCurrency?: string | null;
}): QuickAddCatalog {
  const currencies = new Set(source.currencies.map((code) => code.toUpperCase()));
  if (source.baseCurrency) currencies.add(source.baseCurrency.toUpperCase());
  return {
    accounts: source.accounts.filter((account) => !account.archivedAt).map(({ id, name, entityId, type, currency }) => ({ id, name, entityId, type, currency })),
    entities: source.entities.filter((entity) => !entity.archivedAt).map(({ id, name, kind }) => ({ id, name, kind })),
    categories: source.categories.filter((category) => !category.isArchived).map(({ id, name, type }) => ({ id, name, type })),
    currencies: [...currencies],
  };
}
