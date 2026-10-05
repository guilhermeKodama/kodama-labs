/**
 * Quick add: one line of text → a prefilled "Nova transação" form, used by
 * the field at the top of the create dialog and by ⌘K. Plus the codec of
 * the `create` URL param that carries the result to the dialog.
 *
 * OWNER: S2 (entry CRUD) implements parseQuickAdd; S7 (⌘K) only calls it.
 * Expected behaviour (mockup 4171-4193, chips at 4834-4840), on whitespace
 * separated tokens, case-insensitive:
 * - an amount, "86,90", "1.234,56", "5000", "23.40"; a leading "+" makes
 *   it income ("+5000 invoice acme mercury"), otherwise expense;
 * - an account by the first word of its name ("nubank", "mercury", "xp");
 * - an entity: "pf" (the personal one), "pj" (the only business, if there
 *   is one), or a business by a word of its name ("ltda", "llc");
 * - a date: "hoje", "ontem", "21/09" (this year, or last year when that
 *   would be in the future), "21/09/2026";
 * - "#mercado": a category by name (accents and case ignored), else
 *   categoryName for "+ Criar “Mercado”";
 * - a currency code the catalog has ("usd", "eur", also "us$");
 * - the remaining words, in order, become the description, each word
 *   capitalised ("ifood 86,90 nubank ontem" → "Ifood").
 * Examples to cover: "ifood 86,90 nubank ontem", "aws 222,60 usd llc",
 * "+5000 invoice acme mercury", "mercado #mercado 45", "1.234,56 aluguel",
 * "uber 23,40 21/09".
 */

export type QuickAddKind = "expense" | "income" | "transfer" | "invest";

export interface QuickAddDraft {
  description?: string;
  /** Positive; the direction is `kind`. */
  amount?: number;
  kind?: QuickAddKind;
  /** ISO code, when it differs from the account's currency. */
  currency?: string;
  accountId?: string;
  entityId?: string;
  /** A category of the catalog… */
  categoryId?: string;
  /** …or, when none matched, the name typed after "#" (the dialog offers "+ Criar"). */
  categoryName?: string;
  /** YYYY-MM-DD. */
  date?: string;
}

/** What a chip under the quick-add field names ("Valor", "Conta", "Data"…). */
export type QuickAddField = "amount" | "kind" | "account" | "entity" | "date" | "category" | "currency" | "description";

/** One recognised piece of the text, shown as a chip ("Conta: Nubank · cartão"). */
export interface QuickAddToken {
  field: QuickAddField;
  /** The words typed for it ("nubank", "ontem", "#mercado"). */
  text: string;
}

export interface QuickAddResult {
  draft: QuickAddDraft;
  tokens: QuickAddToken[];
}

/** What the parser matches names against: the signed-in user's catalog (archived items left out). */
export interface QuickAddCatalog {
  accounts: readonly { id: string; name: string; entityId: string; type: string; currency: string }[];
  entities: readonly { id: string; name: string; kind: "personal" | "business" }[];
  categories: readonly { id: string; name: string; type: string }[];
  /** Currency codes the user has ("BRL", "USD"). */
  currencies: readonly string[];
}

/**
 * Parses one line of quick add. `today` is the user's today (YYYY-MM-DD,
 * in their timezone), the base for "hoje", "ontem" and "21/09".
 *
 * STUB until S2: the whole text becomes the description.
 */
export function parseQuickAdd(text: string, catalog: QuickAddCatalog, today: string): QuickAddResult {
  void catalog;
  void today;
  const description = text.trim().replace(/\s+/g, " ");
  return description ? { draft: { description }, tokens: [{ field: "description", text: description }] } : { draft: {}, tokens: [] };
}

// ---------------------------------------------------------------------------
// `create` URL param (/transactions?create=…): "1" opens a blank form, a
// JSON object opens it prefilled.
// ---------------------------------------------------------------------------

const KINDS: readonly QuickAddKind[] = ["expense", "income", "transfer", "invest"];
const TEXT_FIELDS = ["description", "currency", "accountId", "entityId", "categoryId", "categoryName"] as const;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Keeps only well-formed fields, so a hand-edited URL cannot put junk in the form. */
export function cleanQuickAddDraft(value: unknown): QuickAddDraft {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const raw = value as Record<string, unknown>;
  const draft: QuickAddDraft = {};
  for (const field of TEXT_FIELDS) {
    const text = raw[field];
    if (typeof text === "string" && text.trim()) draft[field] = text.trim();
  }
  if (typeof raw.amount === "number" && Number.isFinite(raw.amount) && raw.amount > 0) draft.amount = raw.amount;
  if (typeof raw.kind === "string" && (KINDS as readonly string[]).includes(raw.kind)) draft.kind = raw.kind as QuickAddKind;
  if (typeof raw.date === "string" && ISO_DATE.test(raw.date)) draft.date = raw.date;
  return draft;
}

export function encodeCreateParam(draft: QuickAddDraft = {}): string {
  const clean = cleanQuickAddDraft(draft);
  return Object.keys(clean).length ? JSON.stringify(clean) : "1";
}

/** null when the dialog is closed (no param); a draft, maybe empty, when it is open. */
export function decodeCreateParam(value: string | null | undefined): QuickAddDraft | null {
  if (value === null || value === undefined) return null;
  try {
    return cleanQuickAddDraft(JSON.parse(value));
  } catch {
    return {};
  }
}
