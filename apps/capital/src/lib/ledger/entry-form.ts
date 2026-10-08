import type { QuickAddDraft } from "./quick-add";

/**
 * The "Nova transação" / "Editar transação" form (mockup TxFormBody,
 * 4740-4966) as plain data: its state, what the quick add and an existing
 * entry put in it, the detected transfer type, exchange rates, and the
 * request each save sends. Pure, so the rules are tested without React;
 * the components in components/ledger/entry render it.
 */

export type FormKind = "expense" | "income" | "transfer" | "invest";
export type Frequency = "weekly" | "monthly" | "yearly";
export type InvestDirection = "deposit" | "withdraw";

export interface EntryFormState {
  kind: FormKind;
  /** As typed, in the user's number format. */
  amount: string;
  /** ISO code of the amount; "" = the account's currency. */
  currency: string;
  /** Exchange rate as typed; "" = the default rate. */
  rate: string;
  /**
   * What arrives in the destination currency, as typed. "" = convert from the
   * rate (create) or leave the other leg alone until it is filled (edit).
   */
  received: string;
  /** YYYY-MM-DD. */
  date: string;
  description: string;
  entityId: string;
  accountId: string;
  categoryId: string;
  recurring: boolean;
  frequency: Frequency;
  /** "Lançar automaticamente" (true) or "Só lembrar (push no dia)". */
  autoGenerate: boolean;
  installments: boolean;
  nInstallments: string;
  deductible: boolean;
  fromAccountId: string;
  toAccountId: string;
  reimbursement: boolean;
  investDir: InvestDirection;
  cashAccountId: string;
  brokerAccountId: string;
  /** "Já registrar a compra em {corretora} com esse dinheiro". */
  buyAlso: boolean;
  buyHoldingId: string;
  buyQty: string;
}

export interface FormAccount {
  id: string;
  name: string;
  type: string;
  entityId: string;
  currency: string;
  isDefault?: boolean;
  archivedAt?: string | null;
}

export interface FormEntity {
  id: string;
  kind: "personal" | "business";
  name?: string;
}

export interface FormHolding {
  id: string;
  accountId: string;
  ticker: string | null;
  name: string;
  currentPrice: number | null;
  averageCost: number;
  isActive?: boolean;
  /** Current value of the position, in `currency` (GET /v2/holdings). */
  marketValue?: number | null;
  currency?: string;
}

export interface FormContext {
  accounts: readonly FormAccount[];
  entities: readonly FormEntity[];
  baseCurrency: string;
  /** Value of one unit of each currency in the base currency (BRL base: USD → 5.41). */
  rates: Readonly<Record<string, number>>;
  /** The user's today, YYYY-MM-DD. */
  today: string;
  /** Parses a typed number in the user's format (NaN when unreadable). */
  parseNumber: (text: string) => number;
  holdings?: readonly FormHolding[];
}

export type TransferDirection =
  | "profit_distribution"
  | "capital_injection"
  | "reimbursement"
  | "investment_deposit"
  | "investment_withdrawal"
  | "card_payment"
  | "between_accounts";

const pad = (n: number) => String(n).padStart(2, "0");

/** Today in an IANA timezone, YYYY-MM-DD. */
export function todayIn(timezone: string, now = new Date()): string {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
    const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    return `${get("year")}-${get("month")}-${get("day")}`;
  } catch {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }
}

/** Accounts an income or expense can use: everything but brokers ("corretoras só aparecem em Aporte"). */
export const isCashOrCard = (account: FormAccount) => account.type !== "brokerage";
/** Where an aporte comes from: checking or cash accounts. */
export const isCashAccount = (account: FormAccount) => account.type === "checking" || account.type === "cash";
export const isBroker = (account: FormAccount) => account.type === "brokerage";

const live = (account: FormAccount) => !account.archivedAt;

/** An entity's main account among `accounts` (the default, else the first checking, else any). */
export function mainAccount(accounts: readonly FormAccount[], entityId: string, accept: (account: FormAccount) => boolean = isCashOrCard): FormAccount | undefined {
  const own = accounts.filter((account) => account.entityId === entityId && live(account) && accept(account));
  return own.find((account) => account.isDefault) ?? own.find((account) => account.type === "checking") ?? own[0];
}

function personalEntityId(ctx: FormContext): string {
  return ctx.entities.find((entity) => entity.kind === "personal")?.id ?? ctx.entities[0]?.id ?? "";
}

const accountOf = (ctx: FormContext, id: string) => ctx.accounts.find((account) => account.id === id);

/** A blank form: personal entity, its main account, today. */
export function blankForm(ctx: FormContext): EntryFormState {
  const entityId = personalEntityId(ctx);
  const account = mainAccount(ctx.accounts, entityId);
  const cash = ctx.accounts.find((a) => live(a) && isCashAccount(a) && a.entityId === entityId) ?? ctx.accounts.find((a) => live(a) && isCashAccount(a));
  const broker = ctx.accounts.find((a) => live(a) && isBroker(a) && a.entityId === entityId) ?? ctx.accounts.find((a) => live(a) && isBroker(a));
  const transferable = ctx.accounts.filter((a) => live(a) && isCashOrCard(a));
  const from = transferable.find((a) => a.entityId !== entityId) ?? transferable[0];
  const to = transferable.find((a) => a.id !== from?.id && a.entityId === entityId) ?? transferable.find((a) => a.id !== from?.id);
  return {
    kind: "expense",
    amount: "",
    currency: "",
    rate: "",
    received: "",
    date: ctx.today,
    description: "",
    entityId: account?.entityId ?? entityId,
    accountId: account?.id ?? "",
    categoryId: "",
    recurring: false,
    frequency: "monthly",
    autoGenerate: true,
    installments: false,
    nInstallments: "10",
    deductible: false,
    fromAccountId: from?.id ?? "",
    toAccountId: to?.id ?? "",
    reimbursement: false,
    investDir: "deposit",
    cashAccountId: cash?.id ?? "",
    brokerAccountId: broker?.id ?? "",
    buyAlso: false,
    buyHoldingId: "",
    buyQty: "",
  };
}

/** Formats a number for the amount field ("86,90" in pt-BR). */
export type AmountFormatter = (value: number) => string;

/** Puts a quick-add draft into the form ("Preencher ↵", ⌘K, ?create={…}). Fields the draft lacks stay as they are. */
export function applyDraft(form: EntryFormState, draft: QuickAddDraft, ctx: FormContext, formatAmount: AmountFormatter): EntryFormState {
  const next: EntryFormState = { ...form };
  if (draft.kind) next.kind = draft.kind;
  if (draft.amount !== undefined) next.amount = formatAmount(draft.amount);
  if (draft.date) next.date = draft.date;
  if (draft.description !== undefined) next.description = draft.description;
  if (draft.categoryId) next.categoryId = draft.categoryId;
  const account = draft.accountId ? accountOf(ctx, draft.accountId) : undefined;
  if (account && isCashOrCard(account)) {
    next.accountId = account.id;
    next.entityId = account.entityId;
    next.currency = "";
  } else if (draft.entityId && ctx.entities.some((entity) => entity.id === draft.entityId)) {
    next.entityId = draft.entityId;
    const main = mainAccount(ctx.accounts, draft.entityId);
    if (main) next.accountId = main.id;
    next.currency = "";
  }
  if (draft.currency) next.currency = draft.currency;
  next.rate = "";
  return next;
}

/** The form's amount currency: the chosen one or the account's (the source account for transfers). */
export function formCurrency(form: EntryFormState, ctx: FormContext): string {
  if (form.currency) return form.currency;
  const id = form.kind === "transfer" ? form.fromAccountId : form.kind === "invest" ? (form.investDir === "deposit" ? form.cashAccountId : form.brokerAccountId) : form.accountId;
  return accountOf(ctx, id)?.currency ?? ctx.baseCurrency;
}

/** Value of one unit of `currency` in the base currency (1 for the base, 1 when unknown). */
export function baseRate(currency: string, ctx: FormContext): number {
  if (currency === ctx.baseCurrency) return 1;
  const rate = ctx.rates[currency];
  return rate && Number.isFinite(rate) && rate > 0 ? rate : 1;
}

/** The typed rate, or `fallback` when blank; NaN when it does not read as a positive number. */
export function typedRate(text: string, fallback: number, ctx: FormContext): number {
  if (!text.trim()) return fallback;
  const value = ctx.parseNumber(text);
  return Number.isFinite(value) && value > 0 ? value : Number.NaN;
}

/**
 * What the Câmbio field shows. The mockup shows the rate filled in ("5,41"),
 * so until the person edits it the field displays the default rate while the
 * form keeps "" (= the default: the server's own rate on a plain entry).
 * `editedFor` is the default the person was looking at when they first
 * typed; a new default (another currency or account) fills the field again.
 */
export function rateFieldText(typed: string, defaultText: string, editedFor: string | null): string {
  if (typed) return typed;
  return editedFor === defaultText ? "" : defaultText;
}

/** Amount as typed, NaN when unreadable. */
export function typedAmount(form: EntryFormState, ctx: FormContext): number {
  if (!form.amount.trim()) return Number.NaN;
  return Math.abs(ctx.parseNumber(form.amount));
}

/**
 * Exchange between the two sides of an aporte. With the base currency on
 * one side the rate is quoted as the base value of the other (R$ 5,41 per
 * US$): what arrives is amount ÷ rate leaving the base, amount × rate
 * entering it. Between two foreign currencies it is units of the
 * destination per unit of the source.
 */
export function fxPair(fromCurrency: string, toCurrency: string, ctx: FormContext): { differs: boolean; defaultRate: number; arrives: (amount: number, rate: number) => number } {
  if (fromCurrency === toCurrency) return { differs: false, defaultRate: 1, arrives: (amount) => amount };
  if (fromCurrency === ctx.baseCurrency) return { differs: true, defaultRate: baseRate(toCurrency, ctx), arrives: (amount, rate) => amount / rate };
  if (toCurrency === ctx.baseCurrency) return { differs: true, defaultRate: baseRate(fromCurrency, ctx), arrives: (amount, rate) => amount * rate };
  return { differs: true, defaultRate: baseRate(fromCurrency, ctx) / baseRate(toCurrency, ctx), arrives: (amount, rate) => amount * rate };
}

const round2 = (value: number) => Math.round(value * 100) / 100;

/**
 * Base units per 1 unit of the foreign currency, from the amount that left
 * and the amount that arrived. Null when neither side is the base currency
 * or either amount is missing.
 */
export function effectiveCrossRate(
  fromCurrency: string,
  toCurrency: string,
  amount: number,
  received: number,
  baseCurrency: string,
): number | null {
  if (!(amount > 0) || !(received > 0) || fromCurrency === toCurrency)
    return null;
  if (toCurrency === baseCurrency) return received / amount;
  if (fromCurrency === baseCurrency) return amount / received;
  return null;
}

/** The effective rate is more than `tolerance` (5%) away from the reference PTAX. */
export function rateDeviates(
  effective: number,
  reference: number,
  tolerance = 0.05,
): boolean {
  if (!(effective > 0) || !(reference > 0)) return false;
  return Math.abs(effective - reference) / reference > tolerance;
}

/** The direction the server infers from a transfer's two accounts (entries.ts inferDirection). */
export function detectDirection(from: FormAccount | undefined, to: FormAccount | undefined, entities: readonly FormEntity[]): TransferDirection {
  if (!from || !to) return "between_accounts";
  if (to.type === "credit_card") return "card_payment";
  if (to.type === "brokerage" && from.type !== "brokerage") return "investment_deposit";
  if (from.type === "brokerage" && to.type !== "brokerage") return "investment_withdrawal";
  if (from.entityId !== to.entityId) {
    const kind = (id: string) => entities.find((entity) => entity.id === id)?.kind;
    if (kind(from.entityId) === "business" && kind(to.entityId) === "personal") return "profit_distribution";
    if (kind(from.entityId) === "personal" && kind(to.entityId) === "business") return "capital_injection";
  }
  return "between_accounts";
}

/** The aporte's cash and broker accounts and what crossing them means. */
export function investSides(form: EntryFormState, ctx: FormContext) {
  const cash = accountOf(ctx, form.cashAccountId);
  const broker = accountOf(ctx, form.brokerAccountId);
  const deposit = form.investDir === "deposit";
  const from = deposit ? cash : broker;
  const to = deposit ? broker : cash;
  const fx = fxPair(from?.currency ?? ctx.baseCurrency, to?.currency ?? ctx.baseCurrency, ctx);
  const crossEntity = !!cash && !!broker && cash.entityId !== broker.entityId;
  /** PF money into a company broker is a capital injection; company money into a PF broker, a profit distribution. */
  const entityFlow: "capital_injection" | "profit_distribution" | null = crossEntity
    ? ctx.entities.find((entity) => entity.id === cash!.entityId)?.kind === "personal"
      ? "capital_injection"
      : "profit_distribution"
    : null;
  return { cash, broker, from, to, deposit, fx, crossEntity, entityFlow };
}

/** The holding bought with the aporte and its unit price (current quote, else average cost). */
export function buyHolding(form: EntryFormState, ctx: FormContext): { holding: FormHolding; price: number } | null {
  const holdings = (ctx.holdings ?? []).filter((holding) => holding.accountId === form.brokerAccountId && holding.isActive !== false);
  const holding = holdings.find((candidate) => candidate.id === form.buyHoldingId) ?? holdings[0];
  if (!holding) return null;
  return { holding, price: holding.currentPrice ?? holding.averageCost };
}

/**
 * What a broker account holds in positions ("R$ 312.400 investidos"), in
 * the account's currency: the active holdings' market value, converted
 * through the base-currency rates when a holding is quoted in another one.
 * Null when it holds nothing (or a rate is missing).
 */
export function investedIn(ctx: FormContext, account: Pick<FormAccount, "id" | "currency">): number | null {
  const rateOf = (code: string) => (code === ctx.baseCurrency ? 1 : ctx.rates[code]);
  let total = 0;
  for (const holding of ctx.holdings ?? []) {
    if (holding.accountId !== account.id || holding.isActive === false || !holding.marketValue) continue;
    const code = holding.currency ?? account.currency;
    if (code === account.currency) total += holding.marketValue;
    else {
      const from = rateOf(code);
      const to = rateOf(account.currency);
      if (!from || !to) return null;
      total += (holding.marketValue * from) / to;
    }
  }
  return total > 0 ? round2(total) : null;
}

export type FormError =
  | "amount"
  | "description"
  | "account"
  | "sameAccount"
  | "installments"
  | "rate"
  | "date"
  | "broker"
  | "buyQty";

export type FormField = "amount" | "description" | "account" | "from" | "to" | "installments" | "rate" | "date" | "cash" | "broker" | "buyQty";

export interface FormRequest {
  method: "POST";
  path: string;
  body: Record<string, unknown>;
  /** What the save creates, for the success toast. */
  creates: "entry" | "recurring" | "aporte" | "resgate";
}

export type BuildResult = { ok: true; request: FormRequest } | { ok: false; error: FormError; field: FormField };

export interface CreateExtras {
  /** Category to use when the user picked none: a history or AI suggestion (rules are applied by the server). */
  suggestedCategoryId?: string | null;
  /** Default descriptions ("Aporte XP", "Resgate XP") for aportes typed without one. */
  investDescription: (deposit: boolean, brokerName: string) => string;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const fail = (error: FormError, field: FormField): BuildResult => ({ ok: false, error, field });

/** The request "Salvar" sends for a new entry, or the first problem with the form. */
export function buildCreateRequest(form: EntryFormState, ctx: FormContext, extras: CreateExtras): BuildResult {
  const amount = typedAmount(form, ctx);
  if (!Number.isFinite(amount) || amount <= 0) return fail("amount", "amount");
  if (!ISO_DATE.test(form.date)) return fail("date", "date");
  const description = form.description.trim();

  if (form.kind === "invest") {
    const { cash, broker, deposit, fx, crossEntity } = investSides(form, ctx);
    if (!cash) return fail("account", "cash");
    if (!broker) return fail("broker", "broker");
    const rate = typedRate(form.rate, fx.defaultRate, ctx);
    if (fx.differs && !Number.isFinite(rate)) return fail("rate", "rate");
    const text = description || extras.investDescription(deposit, broker.name);
    if (form.recurring) {
      return {
        ok: true,
        request: {
          method: "POST",
          path: "/api/v2/recurring",
          creates: "recurring",
          body: {
            kind: "transfer",
            accountId: deposit ? cash.id : broker.id,
            toAccountId: deposit ? broker.id : cash.id,
            transferDirection: deposit ? "investment_deposit" : "investment_withdrawal",
            amount,
            description: text,
            frequency: form.frequency,
            startDate: form.date,
            autoGenerate: form.autoGenerate,
          },
        },
      };
    }
    const receivedRaw = form.received.trim()
      ? ctx.parseNumber(form.received)
      : null;
    if (
      fx.differs &&
      form.received.trim() &&
      (receivedRaw == null || !Number.isFinite(receivedRaw) || receivedRaw <= 0)
    )
      return fail("amount", "amount");
    const toAmount = fx.differs
      ? receivedRaw != null && receivedRaw > 0
        ? round2(receivedRaw)
        : round2(fx.arrives(amount, rate))
      : undefined;
    if (deposit && (crossEntity || form.buyAlso)) {
      let buy: Record<string, unknown> | undefined;
      if (form.buyAlso) {
        const chosen = buyHolding(form, ctx);
        const quantity = ctx.parseNumber(form.buyQty);
        if (!chosen || !Number.isFinite(quantity) || quantity <= 0) return fail("buyQty", "buyQty");
        buy = { holdingId: chosen.holding.id, quantity, price: chosen.price };
      }
      return {
        ok: true,
        request: {
          method: "POST",
          path: "/api/v2/investments/aporte",
          creates: "aporte",
          body: {
            fromAccountId: cash.id,
            brokerAccountId: broker.id,
            amount,
            ...(toAmount !== undefined && { toAmount }),
            date: form.date,
            ...(description && { description }),
            ...(buy && { buy }),
          },
        },
      };
    }
    if (!deposit && !fx.differs) {
      return {
        ok: true,
        request: {
          method: "POST",
          path: "/api/v2/brokerage-cash",
          creates: "resgate",
          body: { accountId: broker.id, direction: "withdraw", amount, date: form.date, counterpartAccountId: cash.id, description: text },
        },
      };
    }
    // A plain investment transfer; with two currencies it carries what arrives.
    return {
      ok: true,
      request: {
        method: "POST",
        path: "/api/v2/ledger/entries",
        creates: deposit ? "aporte" : "resgate",
        body: {
          kind: "transfer",
          fromAccountId: deposit ? cash.id : broker.id,
          toAccountId: deposit ? broker.id : cash.id,
          amount,
          ...(toAmount !== undefined && { toAmount }),
          direction: deposit ? "investment_deposit" : "investment_withdrawal",
          date: form.date,
          description: text,
        },
      },
    };
  }

  const currency = formCurrency(form, ctx);
  const foreign = currency !== ctx.baseCurrency;
  const rate = typedRate(form.rate, baseRate(currency, ctx), ctx);
  if (foreign && !Number.isFinite(rate)) return fail("rate", "rate");
  const money = {
    ...(form.currency && { currency }),
    ...(foreign && form.rate.trim() && { exchangeRate: rate }),
  };

  if (form.kind === "transfer") {
    const from = accountOf(ctx, form.fromAccountId);
    const to = accountOf(ctx, form.toAccountId);
    if (!from) return fail("account", "from");
    if (!to) return fail("account", "to");
    if (from.id === to.id) return fail("sameAccount", "to");
    return {
      ok: true,
      request: {
        method: "POST",
        path: "/api/v2/ledger/entries",
        creates: "entry",
        body: {
          kind: "transfer",
          fromAccountId: from.id,
          toAccountId: to.id,
          amount,
          date: form.date,
          ...(description && { description }),
          ...(form.reimbursement && { direction: "reimbursement" }),
          ...money,
        },
      },
    };
  }

  const account = accountOf(ctx, form.accountId);
  if (!account) return fail("account", "account");
  if (!description) return fail("description", "description");
  const categoryId = form.categoryId || extras.suggestedCategoryId || null;
  if (form.recurring) {
    return {
      ok: true,
      request: {
        method: "POST",
        path: "/api/v2/recurring",
        creates: "recurring",
        body: {
          kind: form.kind,
          accountId: account.id,
          amount,
          ...(form.currency && { currency }),
          ...(foreign && form.rate.trim() && { exchangeRate: rate }),
          description,
          categoryId,
          frequency: form.frequency,
          startDate: form.date,
          autoGenerate: form.autoGenerate,
          isTaxDeductible: form.deductible,
        },
      },
    };
  }
  let installments: number | undefined;
  if (form.installments) {
    installments = Number(form.nInstallments);
    if (!Number.isInteger(installments) || installments < 2 || installments > 72) return fail("installments", "installments");
  }
  return {
    ok: true,
    request: {
      method: "POST",
      path: "/api/v2/ledger/entries",
      creates: "entry",
      body: {
        kind: form.kind,
        accountId: account.id,
        amount,
        date: form.date,
        description,
        categoryId,
        ...(form.deductible && { isTaxDeductible: true }),
        ...(installments && { installments }),
        ...money,
      },
    },
  };
}

/** What "Criar outra em seguida" keeps after a save: kind, where the money moved, the date. */
export function nextAfterSave(form: EntryFormState, ctx: FormContext): EntryFormState {
  return {
    ...blankForm(ctx),
    kind: form.kind,
    entityId: form.entityId,
    accountId: form.accountId,
    fromAccountId: form.fromAccountId,
    toAccountId: form.toAccountId,
    investDir: form.investDir,
    cashAccountId: form.cashAccountId,
    brokerAccountId: form.brokerAccountId,
    date: form.date,
  };
}

// ---------------------------------------------------------------------------
// Editing an existing entry
// ---------------------------------------------------------------------------

/** The fields of one entry (any leg of a transfer) the edit form starts from (GET /v2/ledger/entries/{id}). */
export interface EditableEntry {
  id: string;
  kind: "income" | "expense" | "transfer" | "investment";
  description: string;
  date: string;
  /** Signed, in `currency`. */
  amount: number;
  currency: string;
  exchangeRate: number;
  accountId: string;
  entityId: string;
  categoryId: string | null;
  isTaxDeductible: boolean;
  isRecurring: boolean;
  installmentPlanId: string | null;
  transferGroupId: string | null;
  transferDirection: TransferDirection | null;
  counterpartAccountId: string | null;
  /** The other leg, signed as stored. Absent when the entry payload has no pair. */
  counterpartAmount?: number | null;
  counterpartCurrency?: string | null;
}

/** Investment transfers (aportes and resgates) are edited as Aporte. */
export const isInvestDirection = (direction: TransferDirection | null) => direction === "investment_deposit" || direction === "investment_withdrawal";

/** `formatRate` shows the stored exchange rate (more digits than an amount). */
export function formFromEntry(entry: EditableEntry, ctx: FormContext, formatAmount: AmountFormatter, formatRate: AmountFormatter = formatAmount): EntryFormState {
  const base = blankForm(ctx);
  const magnitude = Math.abs(entry.amount);
  const common = {
    ...base,
    amount: formatAmount(magnitude),
    currency: entry.currency,
    rate:
      entry.currency !== ctx.baseCurrency ? formatRate(entry.exchangeRate) : "",
    received: "",
    date: entry.date.slice(0, 10),
    description: entry.description,
    deductible: entry.isTaxDeductible,
    recurring: entry.isRecurring,
    installments: !!entry.installmentPlanId,
  };
  if (entry.transferGroupId) {
    const outgoing = entry.amount < 0;
    const fromAccountId = outgoing ? entry.accountId : (entry.counterpartAccountId ?? "");
    const toAccountId = outgoing ? (entry.counterpartAccountId ?? "") : entry.accountId;
    if (isInvestDirection(entry.transferDirection)) {
      const deposit = entry.transferDirection === "investment_deposit";
      const fromCurrency = accountOf(ctx, fromAccountId)?.currency;
      const toCurrency = accountOf(ctx, toAccountId)?.currency;
      const other =
        entry.counterpartAmount != null
          ? Math.abs(entry.counterpartAmount)
          : null;
      const sourceAbs = outgoing ? magnitude : (other ?? magnitude);
      const destAbs = outgoing ? (other ?? magnitude) : magnitude;
      const cross =
        !!fromCurrency && !!toCurrency && fromCurrency !== toCurrency;
      const foreignAbs =
        fromCurrency === ctx.baseCurrency ? destAbs : sourceAbs;
      const baseAbs = fromCurrency === ctx.baseCurrency ? sourceAbs : destAbs;
      return {
        ...common,
        kind: "invest",
        investDir: deposit ? "deposit" : "withdraw",
        cashAccountId: deposit ? fromAccountId : toAccountId,
        brokerAccountId: deposit ? toAccountId : fromAccountId,
        amount: formatAmount(sourceAbs),
        received: cross ? formatAmount(destAbs) : "",
        rate: cross && foreignAbs > 0 ? formatRate(baseAbs / foreignAbs) : "",
      };
    }
    return { ...common, kind: "transfer", fromAccountId, toAccountId, reimbursement: entry.transferDirection === "reimbursement" };
  }
  return {
    ...common,
    kind: entry.kind === "income" ? "income" : "expense",
    entityId: entry.entityId,
    accountId: entry.accountId,
    categoryId: entry.categoryId ?? "",
  };
}

export type BuildPatchResult = { ok: true; patch: Record<string, unknown> } | { ok: false; error: FormError; field: FormField };

/**
 * PATCH /v2/ledger/entries/{id} body with only what the edit changed
 * (empty when nothing did). `initial` is the form as it opened
 * (formFromEntry), so values that only differ by formatting do not count.
 */
export function buildEditPatch(entry: EditableEntry, initial: EntryFormState, form: EntryFormState, ctx: FormContext): BuildPatchResult {
  const patch: Record<string, unknown> = {};
  const amount = typedAmount(form, ctx);
  if (!Number.isFinite(amount) || amount <= 0) return { ok: false, error: "amount", field: "amount" };
  if (!ISO_DATE.test(form.date)) return { ok: false, error: "date", field: "date" };
  if (form.amount !== initial.amount && Math.abs(amount - Math.abs(entry.amount)) > 0.004) patch.amount = amount;
  if (form.date !== initial.date) patch.date = form.date;
  const description = form.description.trim();
  if (description && description !== initial.description.trim()) patch.description = description;

  if (entry.transferGroupId) {
    const invest = form.kind === "invest";
    const ends = (state: EntryFormState) =>
      invest
        ? state.investDir === "deposit"
          ? [state.cashAccountId, state.brokerAccountId]
          : [state.brokerAccountId, state.cashAccountId]
        : [state.fromAccountId, state.toAccountId];
    const [from, to] = ends(form);
    const [fromBefore, toBefore] = ends(initial);
    if (from && to && from === to) return { ok: false, error: "sameAccount", field: invest ? "broker" : "to" };
    if (from && from !== fromBefore) patch.fromAccountId = from;
    if (to && to !== toBefore) patch.toAccountId = to;
    if (!invest && form.reimbursement !== initial.reimbursement)
      patch.reimbursement = form.reimbursement;
    if (invest) {
      const { fx } = investSides(form, ctx);
      if (fx.differs) {
        // The amount field is the outflow, which may not be the opened leg.
        delete patch.amount;
        const receivedRaw = form.received.trim()
          ? ctx.parseNumber(form.received)
          : null;
        const receivedChanged = form.received !== initial.received;
        if (receivedChanged) {
          if (
            receivedRaw == null ||
            !Number.isFinite(receivedRaw) ||
            receivedRaw <= 0
          )
            return { ok: false, error: "amount", field: "amount" };
          patch.toAmount = round2(receivedRaw);
        }
        if (form.amount !== initial.amount) patch.amount = amount;
        if (
          patch.amount !== undefined &&
          patch.toAmount === undefined &&
          receivedRaw != null &&
          receivedRaw > 0
        )
          patch.toAmount = round2(receivedRaw);
        if (
          !receivedChanged &&
          form.rate.trim() &&
          form.rate !== initial.rate
        ) {
          const rate = typedRate(form.rate, fx.defaultRate, ctx);
          if (!Number.isFinite(rate))
            return { ok: false, error: "rate", field: "rate" };
          patch.exchangeRate = rate;
        }
      }
    }
    return { ok: true, patch };
  }

  if (!description) return { ok: false, error: "description", field: "description" };
  if (entry.kind !== "investment" && form.kind !== initial.kind && (form.kind === "income" || form.kind === "expense")) patch.kind = form.kind;
  if (form.accountId && form.accountId !== initial.accountId) patch.accountId = form.accountId;
  else if (form.entityId && form.entityId !== initial.entityId) patch.entityId = form.entityId;
  if (form.categoryId !== initial.categoryId) patch.categoryId = form.categoryId || null;
  if (form.deductible !== initial.deductible) patch.isTaxDeductible = form.deductible;
  const currency = form.currency || entry.currency;
  if (currency !== (initial.currency || entry.currency)) patch.currency = currency;
  if (currency !== ctx.baseCurrency && form.rate.trim() && form.rate !== initial.rate) {
    const rate = typedRate(form.rate, entry.exchangeRate, ctx);
    if (!Number.isFinite(rate)) return { ok: false, error: "rate", field: "rate" };
    patch.exchangeRate = rate;
  }
  return { ok: true, patch };
}

/**
 * A date typed in the user's format ("21/09/2026", "09/21/2026",
 * "2026-09-21"), also without the year ("21/09", this year) or with two
 * digits ("21/09/26"). YYYY-MM-DD, or null when it is not a real date.
 */
export function parseDateText(text: string, dateFormat: string, today: string): string | null {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  const parts = iso ? null : /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/.exec(value);
  let year: number;
  let month: number;
  let day: number;
  if (iso) {
    [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (parts) {
    const monthFirst = dateFormat.startsWith("MM");
    day = Number(monthFirst ? parts[2] : parts[1]);
    month = Number(monthFirst ? parts[1] : parts[2]);
    year = parts[3] ? (parts[3].length === 2 ? 2000 + Number(parts[3]) : Number(parts[3])) : Number(today.slice(0, 4));
  } else return null;
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/**
 * The form value of the Data field for its text: the date (YYYY-MM-DD), or
 * "" while the text is empty or not a real date, so Salvar stops at the
 * field ("Data inválida") instead of saving the last valid date.
 */
export function dateInputValue(text: string, dateFormat: string, today: string): string {
  return parseDateText(text, dateFormat, today) ?? "";
}
