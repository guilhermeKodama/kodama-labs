/**
 * Quick add: one line of text → a prefilled "Nova transação" form, used by
 * the field at the top of the create dialog and by ⌘K. Plus the codec of
 * the `create` URL param that carries the result to the dialog.
 *
 * OWNER: S2 (entry CRUD) implements parseQuickAdd; S7 (⌘K) only calls it.
 * Behaviour (mockup 4171-4193, chips at 4834-4840), on whitespace
 * separated tokens, case and accents ignored:
 * - an amount, "86,90", "1.234,56", "5000", "23.40"; a leading "+" makes
 *   it income ("+5000 invoice acme mercury"), otherwise expense. Only the
 *   first number is the amount; later ones stay in the description;
 * - an account by the words of its name, from the first one ("nubank",
 *   "nubank cartão", "mercury", "xp"); brokerage accounts are left out
 *   (they only take aportes). When a word names several accounts
 *   ("nubank": Nubank and Nubank · cartão), an expense goes to the card
 *   and an income to the checking account, as in the mockup;
 * - an entity: "pf" (the personal one), "pj" (the first business), or a
 *   business by a word of its name ("ltda", "llc"). Without an account
 *   word, the entity's main account is used;
 * - a date: "hoje", "ontem" (also "today", "yesterday"), "21/09" (this
 *   year, or last year when that would be in the future), "21/09/2026";
 * - "#mercado": a category by name (accents and case ignored), else
 *   categoryName for "+ Criar “Mercado”";
 * - a currency the catalog has ("usd", "eur", also "us$", "r$", "€");
 * - the remaining words, in order, become the description, each word
 *   capitalised ("ifood 86,90 nubank ontem" → "Ifood").
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
  /** `isDefault` marks an entity's main account ("Conta principal"), used when only the entity is typed. */
  accounts: readonly { id: string; name: string; entityId: string; type: string; currency: string; isDefault?: boolean }[];
  entities: readonly { id: string; name: string; kind: "personal" | "business" }[];
  categories: readonly { id: string; name: string; type: string }[];
  /** Currency codes the user has ("BRL", "USD"). */
  currencies: readonly string[];
}

/** Lower case without accents, for matching typed words against names. */
export function normalizeWord(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** The words of a name ("Nubank · cartão" → ["nubank", "cartao"]). */
function nameWords(name: string): string[] {
  return normalizeWord(name).split(/[^a-z0-9]+/).filter(Boolean);
}

const PT_GROUPED = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/;
const EN_GROUPED = /^\d{1,3}(,\d{3})+(\.\d{1,2})?$/;
const PLAIN = /^\d+([.,]\d{1,2})?$/;

/** "86,90" → 86.9, "1.234,56" → 1234.56, "23.40" → 23.4, "5000" → 5000; null for anything else. */
export function parseQuickAmount(text: string): number | null {
  let value: number;
  if (PT_GROUPED.test(text)) value = Number(text.replace(/\./g, "").replace(",", "."));
  else if (EN_GROUPED.test(text)) value = Number(text.replace(/,/g, ""));
  else if (PLAIN.test(text)) value = Number(text.replace(",", "."));
  else return null;
  return Number.isFinite(value) && value > 0 ? value : null;
}

const pad = (n: number) => String(n).padStart(2, "0");

function shiftDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1) return null;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return day > last ? null : `${year}-${pad(month)}-${pad(day)}`;
}

const TODAY_WORDS = new Set(["hoje", "today"]);
const YESTERDAY_WORDS = new Set(["ontem", "yesterday"]);

/** "hoje", "ontem", "21/09", "21/09/26", "21/09/2026" (day first) → YYYY-MM-DD, relative to `today`. */
export function parseQuickDate(word: string, today: string): string | null {
  if (TODAY_WORDS.has(word)) return today;
  if (YESTERDAY_WORDS.has(word)) return shiftDays(today, -1);
  const match = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?$/.exec(word);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  if (match[3]) {
    const year = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
    return validDate(year, month, day);
  }
  const thisYear = Number(today.slice(0, 4));
  const candidate = validDate(thisYear, month, day);
  if (!candidate) return null;
  return candidate > today ? validDate(thisYear - 1, month, day) : candidate;
}

/**
 * Words that start account names without naming one ("Conta principal",
 * "Main account", "Cartão Inter"): typed alone they are part of the
 * description ("conta de luz 120"); the whole name still picks the account.
 */
const GENERIC_ACCOUNT_WORDS = new Set(["conta", "contas", "cartao", "banco", "carteira", "principal", "main", "account", "card", "bank", "wallet", "checking"]);

const CURRENCY_SYMBOLS:Record<string, string> = { "us$": "USD", "r$": "BRL", "€": "EUR", "£": "GBP" };

function capitalise(word: string): string {
  return word.slice(0, 1).toUpperCase() + word.slice(1);
}

type CatalogAccount = QuickAddCatalog["accounts"][number];

/**
 * Parses one line of quick add. `today` is the user's today (YYYY-MM-DD,
 * in their timezone), the base for "hoje", "ontem" and "21/09".
 */
export function parseQuickAdd(text: string, catalog: QuickAddCatalog, today: string): QuickAddResult {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const accounts = catalog.accounts.filter((account) => account.type !== "brokerage");
  const accountWords = accounts.map((account) => ({ account, words: nameWords(account.name) }));
  const businesses = catalog.entities.filter((entity) => entity.kind === "business");
  const currencies = new Set(catalog.currencies.map((code) => code.toUpperCase()));

  const draft: QuickAddDraft = {};
  const tokens: QuickAddToken[] = [];
  const rest: string[] = [];
  let accountCandidates: CatalogAccount[] | null = null;
  let entityId: string | null = null;
  let categoryWord: string | null = null;

  for (let i = 0; i < words.length; i++) {
    const raw = words[i];
    const word = normalizeWord(raw);

    // Amount: the first number, "+" for income.
    const sign = /^[+-]/.test(raw) ? raw[0] : "";
    const amount = draft.amount === undefined ? parseQuickAmount(sign ? raw.slice(1) : raw) : null;
    if (amount !== null) {
      draft.amount = amount;
      draft.kind = sign === "+" ? "income" : "expense";
      tokens.push({ field: "amount", text: raw });
      if (sign === "+") tokens.push({ field: "kind", text: "+" });
      continue;
    }

    const date = draft.date === undefined ? parseQuickDate(word, today) : null;
    if (date) {
      draft.date = date;
      tokens.push({ field: "date", text: raw });
      continue;
    }

    if (raw.startsWith("#") && raw.length > 1 && categoryWord === null) {
      categoryWord = raw.slice(1);
      tokens.push({ field: "category", text: raw });
      continue;
    }

    const currency = CURRENCY_SYMBOLS[word] ?? word.toUpperCase();
    if (draft.currency === undefined && /^[a-z$€£]{1,3}$/.test(word) && currencies.has(currency)) {
      draft.currency = currency;
      tokens.push({ field: "currency", text: raw });
      continue;
    }

    // Account: the longest run of words that starts an account's name.
    if (accountCandidates === null) {
      let best = 0;
      let matches: CatalogAccount[] = [];
      for (const { account, words: name } of accountWords) {
        let k = 0;
        while (k < name.length && i + k < words.length && normalizeWord(words[i + k]) === name[k]) k++;
        if (k === 0) continue;
        if (k > best) {
          best = k;
          matches = [account];
        } else if (k === best) matches.push(account);
      }
      // A run that spells a whole name picks that account only.
      const whole = matches.filter((account) => nameWords(account.name).length === best);
      // "conta de luz": a generic word that only starts a name ("Conta principal", every entity's main account) is description.
      if (best === 1 && !whole.length && GENERIC_ACCOUNT_WORDS.has(word)) best = 0;
      if (best > 0) {
        accountCandidates = best > 1 && whole.length ? whole : matches;
        tokens.push({ field: "account", text: words.slice(i, i + best).join(" ") });
        i += best - 1;
        continue;
      }
    }

    if (entityId === null) {
      const personal = catalog.entities.find((entity) => entity.kind === "personal");
      const entity =
        word === "pf" ? personal : word === "pj" ? businesses[0] : businesses.find((business) => nameWords(business.name).includes(word) && word.length > 1);
      if (entity) {
        entityId = entity.id;
        tokens.push({ field: "entity", text: raw });
        continue;
      }
    }

    rest.push(raw);
  }

  const kind = draft.kind ?? "expense";
  if (accountCandidates?.length) {
    const scoped = entityId ? accountCandidates.filter((account) => account.entityId === entityId) : [];
    const pool = scoped.length ? scoped : accountCandidates;
    const preferred = kind === "income" ? ["checking", "cash", "credit_card"] : ["credit_card", "checking", "cash"];
    const rank = (account: CatalogAccount) => {
      const index = preferred.indexOf(account.type);
      return index < 0 ? preferred.length : index;
    };
    const account = [...pool].sort((a, b) => rank(a) - rank(b))[0];
    draft.accountId = account.id;
    draft.entityId = account.entityId;
  } else if (entityId) {
    draft.entityId = entityId;
    const own = accounts.filter((account) => account.entityId === entityId);
    const main = own.find((account) => account.isDefault) ?? own.find((account) => account.type === "checking") ?? own[0];
    if (main) draft.accountId = main.id;
  }

  // A currency equal to the account's adds nothing.
  if (draft.currency && draft.accountId) {
    const account = accounts.find((candidate) => candidate.id === draft.accountId);
    if (account && account.currency.toUpperCase() === draft.currency) delete draft.currency;
  }

  if (categoryWord !== null) {
    const wanted = normalizeWord(categoryWord);
    const type = kind === "income" ? "income" : "expense";
    const named = (category: QuickAddCatalog["categories"][number]) => normalizeWord(category.name) === wanted;
    const starts = (category: QuickAddCatalog["categories"][number]) => normalizeWord(category.name).startsWith(wanted);
    const ofType = catalog.categories.filter((category) => category.type === type);
    const match = ofType.find(named) ?? catalog.categories.find(named) ?? ofType.find(starts) ?? catalog.categories.find(starts);
    if (match) draft.categoryId = match.id;
    else draft.categoryName = capitalise(categoryWord);
  }

  if (rest.length) {
    draft.description = rest.map(capitalise).join(" ");
    tokens.push({ field: "description", text: draft.description });
  }
  return { draft, tokens };
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
