import { describe, expect, it } from "vitest";
import { parseLocaleNumber } from "@/lib/format";
import {
  applyDraft,
  blankForm,
  buildCreateRequest,
  buildEditPatch,
  dateInputValue,
  detectDirection,
  effectiveCrossRate,
  formFromEntry,
  fxPair,
  investSides,
  investedIn,
  nextAfterSave,
  parseDateText,
  rateDeviates,
  rateFieldText,
  todayIn,
  type EditableEntry,
  type EntryFormState,
  type FormContext,
} from "@/lib/ledger/entry-form";

const ctx: FormContext = {
  accounts: [
    { id: "nubank", name: "Nubank", type: "checking", entityId: "pf", currency: "BRL", isDefault: true },
    { id: "nubank-card", name: "Nubank · cartão", type: "credit_card", entityId: "pf", currency: "BRL" },
    { id: "xp", name: "XP", type: "brokerage", entityId: "pf", currency: "BRL" },
    { id: "avenue", name: "Avenue", type: "brokerage", entityId: "pf", currency: "USD" },
    { id: "inter", name: "Inter PJ", type: "checking", entityId: "ltda", currency: "BRL", isDefault: true },
    { id: "inter-invest", name: "Inter Invest", type: "brokerage", entityId: "ltda", currency: "BRL" },
    { id: "mercury", name: "Mercury", type: "checking", entityId: "llc", currency: "USD", isDefault: true },
    { id: "old", name: "Antiga", type: "checking", entityId: "pf", currency: "BRL", archivedAt: "2026-01-01" },
  ],
  entities: [
    { id: "pf", kind: "personal" },
    { id: "ltda", kind: "business" },
    { id: "llc", kind: "business" },
  ],
  baseCurrency: "BRL",
  rates: { USD: 5.41, EUR: 6 },
  today: "2026-09-22",
  parseNumber: (text) => parseLocaleNumber(text, "pt-BR"),
  holdings: [
    { id: "bova", accountId: "xp", ticker: "BOVA11", name: "iShares Ibovespa", currentPrice: 130, averageCost: 120 },
    { id: "ivvb", accountId: "xp", ticker: "IVVB11", name: "iShares S&P 500", currentPrice: null, averageCost: 300 },
  ],
};

const brl = (value: number) => value.toFixed(2).replace(".", ",");
const extras = { investDescription: (deposit: boolean, broker: string) => `${deposit ? "Aporte" : "Resgate"} ${broker}` };
const form = (patch: Partial<EntryFormState> = {}): EntryFormState => ({ ...blankForm(ctx), ...patch });
const request = (patch: Partial<EntryFormState>, more: Partial<typeof extras & { suggestedCategoryId: string }> = {}) => {
  const result = buildCreateRequest(form(patch), ctx, { ...extras, ...more });
  if (!result.ok) throw new Error(`unexpected ${result.error}`);
  return result.request;
};

describe("blankForm", () => {
  it("starts on the personal entity's main account, today, expense", () => {
    expect(blankForm(ctx)).toMatchObject({ kind: "expense", entityId: "pf", accountId: "nubank", date: "2026-09-22", cashAccountId: "nubank", brokerAccountId: "xp", nInstallments: "10" });
  });

  it("offers a company → PF transfer by default", () => {
    const { fromAccountId, toAccountId } = blankForm(ctx);
    expect(fromAccountId).toBe("inter");
    expect(toAccountId).toBe("nubank");
  });
});

describe("applyDraft", () => {
  it("fills what the quick add found and keeps the rest", () => {
    const next = applyDraft(form({ description: "old" }), { description: "Ifood", amount: 86.9, accountId: "nubank-card", date: "2026-09-21" }, ctx, brl);
    expect(next).toMatchObject({ description: "Ifood", amount: "86,90", accountId: "nubank-card", entityId: "pf", date: "2026-09-21", kind: "expense" });
  });

  it("uses the entity's main account when only the entity was typed, and the currency", () => {
    expect(applyDraft(form(), { entityId: "llc", currency: "USD", amount: 10 }, ctx, brl)).toMatchObject({ entityId: "llc", accountId: "mercury", currency: "USD" });
  });

  it("switches to income on +", () => {
    expect(applyDraft(form(), { kind: "income", amount: 5000 }, ctx, brl).kind).toBe("income");
  });
});

describe("detectDirection", () => {
  const acc = (id: string) => ctx.accounts.find((a) => a.id === id);
  it("mirrors the server's inference", () => {
    expect(detectDirection(acc("inter"), acc("nubank"), ctx.entities)).toBe("profit_distribution");
    expect(detectDirection(acc("nubank"), acc("inter"), ctx.entities)).toBe("capital_injection");
    expect(detectDirection(acc("nubank"), acc("nubank-card"), ctx.entities)).toBe("card_payment");
    expect(detectDirection(acc("nubank"), acc("xp"), ctx.entities)).toBe("investment_deposit");
    expect(detectDirection(acc("xp"), acc("nubank"), ctx.entities)).toBe("investment_withdrawal");
    expect(detectDirection(acc("inter"), acc("mercury"), ctx.entities)).toBe("between_accounts");
  });
});

describe("fxPair", () => {
  it("quotes against the base currency both ways", () => {
    const out = fxPair("BRL", "USD", ctx);
    expect(out.defaultRate).toBe(5.41);
    expect(out.arrives(541, 5.41)).toBeCloseTo(100);
    const back = fxPair("USD", "BRL", ctx);
    expect(back.arrives(100, 5.41)).toBeCloseTo(541);
    expect(fxPair("USD", "EUR", ctx).defaultRate).toBeCloseTo(5.41 / 6);
    expect(fxPair("BRL", "BRL", ctx).differs).toBe(false);
  });
});

describe("buildCreateRequest", () => {
  it("creates an expense with the suggestion when no category was picked", () => {
    expect(request({ amount: "86,90", description: "iFood", accountId: "nubank-card" }, { suggestedCategoryId: "rest" })).toEqual({
      method: "POST",
      path: "/api/v2/ledger/entries",
      creates: "entry",
      body: { kind: "expense", accountId: "nubank-card", amount: 86.9, date: "2026-09-22", description: "iFood", categoryId: "rest" },
    });
  });

  it("sends installments, the IR flag, a foreign currency and a typed rate", () => {
    expect(request({ amount: "1.200,00", description: "Notebook", installments: true, nInstallments: "10", deductible: true }).body).toMatchObject({ amount: 1200, installments: 10, isTaxDeductible: true });
    expect(request({ amount: "222,60", description: "AWS", currency: "USD", rate: "5,50" }).body).toMatchObject({ currency: "USD", exchangeRate: 5.5 });
    expect(request({ amount: "222,60", description: "AWS", currency: "USD" }).body).not.toHaveProperty("exchangeRate");
  });

  it("refuses bad input with the field to mark", () => {
    expect(buildCreateRequest(form({ amount: "" , description: "x" }), ctx, extras)).toEqual({ ok: false, error: "amount", field: "amount" });
    expect(buildCreateRequest(form({ amount: "10" }), ctx, extras)).toEqual({ ok: false, error: "description", field: "description" });
    expect(buildCreateRequest(form({ amount: "10", description: "x", installments: true, nInstallments: "1" }), ctx, extras)).toMatchObject({ error: "installments" });
    expect(buildCreateRequest(form({ kind: "transfer", amount: "10", fromAccountId: "nubank", toAccountId: "nubank" }), ctx, extras)).toMatchObject({ error: "sameAccount" });
    expect(buildCreateRequest(form({ amount: "10", description: "x", currency: "USD", rate: "abc" }), ctx, extras)).toMatchObject({ error: "rate" });
  });

  it("creates a recurring rule instead of an entry", () => {
    expect(request({ amount: "3.200", description: "Aluguel", recurring: true, frequency: "monthly", autoGenerate: false })).toMatchObject({
      path: "/api/v2/recurring",
      creates: "recurring",
      body: { kind: "expense", accountId: "nubank", amount: 3200, startDate: "2026-09-22", frequency: "monthly", autoGenerate: false, isTaxDeductible: false },
    });
  });

  it("creates a transfer, as a reimbursement when asked", () => {
    expect(request({ kind: "transfer", amount: "5.000", fromAccountId: "inter", toAccountId: "nubank", reimbursement: true }).body).toEqual({
      kind: "transfer",
      fromAccountId: "inter",
      toAccountId: "nubank",
      amount: 5000,
      date: "2026-09-22",
      direction: "reimbursement",
    });
  });

  it("books a same-entity aporte as an investment transfer", () => {
    expect(request({ kind: "invest", amount: "1.000", cashAccountId: "nubank", brokerAccountId: "xp" })).toEqual({
      method: "POST",
      path: "/api/v2/ledger/entries",
      creates: "aporte",
      body: { kind: "transfer", fromAccountId: "nubank", toAccountId: "xp", amount: 1000, direction: "investment_deposit", date: "2026-09-22", description: "Aporte XP" },
    });
  });

  it("sends a cross-entity aporte or one with a buy to the aporte endpoint", () => {
    expect(request({ kind: "invest", amount: "1.000", cashAccountId: "nubank", brokerAccountId: "inter-invest" })).toMatchObject({
      path: "/api/v2/investments/aporte",
      body: { fromAccountId: "nubank", brokerAccountId: "inter-invest", amount: 1000, date: "2026-09-22" },
    });
    expect(request({ kind: "invest", amount: "8.000", cashAccountId: "nubank", brokerAccountId: "xp", buyAlso: true, buyHoldingId: "bova", buyQty: "60" }).body).toMatchObject({
      buy: { holdingId: "bova", quantity: 60, price: 130 },
    });
    expect(buildCreateRequest(form({ kind: "invest", amount: "10", buyAlso: true, buyQty: "" }), ctx, extras)).toMatchObject({ error: "buyQty" });
  });

  it("converts what arrives at a broker in another currency", () => {
    expect(request({ kind: "invest", amount: "5.410", cashAccountId: "nubank", brokerAccountId: "avenue" }).body).toMatchObject({ toAmount: 1000 });
    expect(request({ kind: "invest", amount: "5.500", cashAccountId: "nubank", brokerAccountId: "avenue", rate: "5,50" }).body).toMatchObject({ toAmount: 1000 });
  });

  it("sends the typed received amount instead of the rate-derived one", () => {
    expect(
      request({
        kind: "invest",
        investDir: "withdraw",
        amount: "6.757,75",
        cashAccountId: "nubank",
        brokerAccountId: "avenue",
        received: "33.721,17",
      }).body,
    ).toMatchObject({
      fromAccountId: "avenue",
      toAccountId: "nubank",
      amount: 6757.75,
      toAmount: 33721.17,
      direction: "investment_withdrawal",
    });
    expect(
      request({
        kind: "invest",
        amount: "33.721,17",
        cashAccountId: "nubank",
        brokerAccountId: "avenue",
        received: "6.757,75",
      }).body,
    ).toMatchObject({
      toAmount: 6757.75,
    });
  });

  it("withdraws through brokerage cash, and as a transfer across currencies", () => {
    expect(request({ kind: "invest", investDir: "withdraw", amount: "500", cashAccountId: "nubank", brokerAccountId: "xp" })).toMatchObject({
      path: "/api/v2/brokerage-cash",
      creates: "resgate",
      body: { accountId: "xp", direction: "withdraw", amount: 500, counterpartAccountId: "nubank", description: "Resgate XP" },
    });
    expect(request({ kind: "invest", investDir: "withdraw", amount: "100", cashAccountId: "nubank", brokerAccountId: "avenue" })).toMatchObject({
      path: "/api/v2/ledger/entries",
      body: { fromAccountId: "avenue", toAccountId: "nubank", toAmount: 541, direction: "investment_withdrawal" },
    });
  });

  it("books a recurring aporte as a recurring investment transfer", () => {
    expect(request({ kind: "invest", amount: "2.000", recurring: true, cashAccountId: "nubank", brokerAccountId: "xp" }).body).toMatchObject({
      kind: "transfer",
      accountId: "nubank",
      toAccountId: "xp",
      transferDirection: "investment_deposit",
      description: "Aporte XP",
    });
  });
});

describe("investSides", () => {
  it("names the inter-entity flow of an aporte", () => {
    expect(investSides(form({ kind: "invest", cashAccountId: "nubank", brokerAccountId: "inter-invest" }), ctx)).toMatchObject({ crossEntity: true, entityFlow: "capital_injection" });
    expect(investSides(form({ kind: "invest", cashAccountId: "inter", brokerAccountId: "xp" }), ctx)).toMatchObject({ crossEntity: true, entityFlow: "profit_distribution" });
  });
});

describe("nextAfterSave", () => {
  it("keeps kind, accounts and date, clears the rest", () => {
    const next = nextAfterSave(form({ kind: "income", amount: "10", description: "x", accountId: "mercury", entityId: "llc", date: "2026-09-01", categoryId: "c" }), ctx);
    expect(next).toMatchObject({ kind: "income", amount: "", description: "", accountId: "mercury", entityId: "llc", date: "2026-09-01", categoryId: "" });
  });
});

describe("editing", () => {
  const entry: EditableEntry = {
    id: "e1",
    kind: "expense",
    description: "iFood",
    date: "2026-09-21",
    amount: -86.9,
    currency: "BRL",
    exchangeRate: 1,
    accountId: "nubank-card",
    entityId: "pf",
    categoryId: "rest",
    isTaxDeductible: false,
    isRecurring: false,
    installmentPlanId: null,
    transferGroupId: null,
    transferDirection: null,
    counterpartAccountId: null,
  };
  const initial = formFromEntry(entry, ctx, brl);

  it("opens an entry as the form", () => {
    expect(initial).toMatchObject({ kind: "expense", amount: "86,90", accountId: "nubank-card", categoryId: "rest", date: "2026-09-21" });
  });

  it("stops Salvar at the Data field when its text is empty or not a date, instead of keeping the old date", () => {
    for (const text of ["", "31/02/2026", "ontem"]) {
      const date = dateInputValue(text, "dd/MM/yyyy", ctx.today);
      expect(buildEditPatch(entry, initial, { ...initial, description: "Outra", date }, ctx)).toEqual({ ok: false, error: "date", field: "date" });
      expect(buildCreateRequest(form({ amount: "10", description: "x", date }), ctx, extras)).toEqual({ ok: false, error: "date", field: "date" });
    }
    expect(buildEditPatch(entry, initial, { ...initial, date: dateInputValue("20/09", "dd/MM/yyyy", ctx.today) }, ctx)).toEqual({ ok: true, patch: { date: "2026-09-20" } });
  });

  it("patches only what changed, including income ↔ expense", () => {
    expect(buildEditPatch(entry, initial, initial, ctx)).toEqual({ ok: true, patch: {} });
    expect(buildEditPatch(entry, initial, { ...initial, amount: "90,00", kind: "income", categoryId: "" }, ctx)).toEqual({
      ok: true,
      patch: { amount: 90, kind: "income", categoryId: null },
    });
    expect(buildEditPatch(entry, initial, { ...initial, entityId: "ltda", accountId: "nubank-card" }, ctx)).toEqual({ ok: true, patch: { entityId: "ltda" } });
  });

  it("opens a transfer leg with its endpoints and patches them together", () => {
    const leg: EditableEntry = { ...entry, kind: "transfer", amount: 5000, accountId: "nubank", entityId: "pf", categoryId: null, transferGroupId: "g", transferDirection: "profit_distribution", counterpartAccountId: "inter" };
    const start = formFromEntry(leg, ctx, brl);
    expect(start).toMatchObject({ kind: "transfer", fromAccountId: "inter", toAccountId: "nubank", reimbursement: false });
    expect(buildEditPatch(leg, start, { ...start, fromAccountId: "mercury", reimbursement: true }, ctx)).toEqual({ ok: true, patch: { fromAccountId: "mercury", reimbursement: true } });
  });

  it("opens a cross-currency resgate with the received amount and patches that amount, the rate, or both legs", () => {
    const leg: EditableEntry = {
      ...entry,
      kind: "transfer",
      description: "Resgate Crypto",
      amount: 33721.17,
      currency: "BRL",
      exchangeRate: 1,
      accountId: "nubank",
      categoryId: null,
      transferGroupId: "g",
      transferDirection: "investment_withdrawal",
      counterpartAccountId: "avenue",
      counterpartAmount: -6757.75,
      counterpartCurrency: "USD",
    };
    const start = formFromEntry(leg, ctx, brl);
    expect(start).toMatchObject({
      kind: "invest",
      investDir: "withdraw",
      cashAccountId: "nubank",
      brokerAccountId: "avenue",
      amount: "6757,75",
      received: "33721,17",
    });
    expect(
      buildEditPatch(
        leg,
        start,
        { ...start, received: "30.000,00", rate: "4,44" },
        ctx,
      ),
    ).toEqual({ ok: true, patch: { toAmount: 30000 } });
    expect(buildEditPatch(leg, start, { ...start, rate: "5,10" }, ctx)).toEqual(
      { ok: true, patch: { exchangeRate: 5.1 } },
    );
    expect(
      buildEditPatch(leg, start, { ...start, amount: "7.000,00" }, ctx),
    ).toEqual({ ok: true, patch: { amount: 7000, toAmount: 33721.17 } });
  });

  it("opens an aporte as Aporte", () => {
    const leg: EditableEntry = { ...entry, kind: "transfer", amount: -1000, accountId: "nubank", transferGroupId: "g", transferDirection: "investment_deposit", counterpartAccountId: "xp" };
    const start = formFromEntry(leg, ctx, brl);
    expect(start).toMatchObject({ kind: "invest", investDir: "deposit", cashAccountId: "nubank", brokerAccountId: "xp" });
    expect(buildEditPatch(leg, start, { ...start, brokerAccountId: "avenue" }, ctx)).toEqual({ ok: true, patch: { toAccountId: "avenue" } });
  });
});

describe("effectiveCrossRate", () => {
  it("quotes base per foreign unit and warns only past 5%", () => {
    expect(
      effectiveCrossRate("USD", "BRL", 6757.75, 33721.17, "BRL"),
    ).toBeCloseTo(4.98999963, 8);
    expect(
      effectiveCrossRate("BRL", "USD", 33721.17, 6757.75, "BRL"),
    ).toBeCloseTo(4.98999963, 8);
    expect(effectiveCrossRate("USD", "EUR", 10, 9, "BRL")).toBeNull();
    expect(rateDeviates(4.98999963, 5.2204)).toBe(false);
    expect(rateDeviates(4.5, 5.2204)).toBe(true);
  });
});

describe("todayIn", () => {
  it("is the calendar day in the zone", () => {
    const now = new Date("2026-09-22T01:30:00Z");
    expect(todayIn("America/Sao_Paulo", now)).toBe("2026-09-21");
    expect(todayIn("UTC", now)).toBe("2026-09-22");
  });
});

describe("parseDateText", () => {
  it("reads the user's format, with or without the year", () => {
    expect(parseDateText("21/09/2026", "dd/MM/yyyy", "2026-10-01")).toBe("2026-09-21");
    expect(parseDateText("21/09", "dd/MM/yyyy", "2026-10-01")).toBe("2026-09-21");
    expect(parseDateText("09/21/26", "MM/dd/yyyy", "2026-10-01")).toBe("2026-09-21");
    expect(parseDateText("2026-09-21", "dd/MM/yyyy", "2026-10-01")).toBe("2026-09-21");
    expect(parseDateText("31/02/2026", "dd/MM/yyyy", "2026-10-01")).toBeNull();
    expect(parseDateText("ontem", "dd/MM/yyyy", "2026-10-01")).toBeNull();
  });
});

describe("investedIn", () => {
  const withHoldings = (holdings: FormContext["holdings"]): FormContext => ({ ...ctx, holdings });

  it("sums the broker's active positions in its currency, converting other quotes", () => {
    const here = withHoldings([
      { id: "a", accountId: "xp", ticker: "BOVA11", name: "a", currentPrice: 130, averageCost: 120, marketValue: 7800, currency: "BRL" },
      { id: "b", accountId: "xp", ticker: "IVVB11", name: "b", currentPrice: null, averageCost: 300, marketValue: 100, currency: "USD" },
      { id: "c", accountId: "xp", ticker: "OLD", name: "c", currentPrice: 1, averageCost: 1, marketValue: 999, isActive: false },
      { id: "d", accountId: "avenue", ticker: "VOO", name: "d", currentPrice: 1, averageCost: 1, marketValue: 541, currency: "BRL" },
    ]);
    expect(investedIn(here, { id: "xp", currency: "BRL" })).toBe(8341);
    expect(investedIn(here, { id: "avenue", currency: "USD" })).toBe(100);
  });

  it("is null for an empty broker or a missing rate", () => {
    expect(investedIn(withHoldings([]), { id: "xp", currency: "BRL" })).toBeNull();
    const gbp = withHoldings([{ id: "a", accountId: "xp", ticker: null, name: "a", currentPrice: 1, averageCost: 1, marketValue: 10, currency: "GBP" }]);
    expect(investedIn(gbp, { id: "xp", currency: "BRL" })).toBeNull();
  });
});

describe("rateFieldText", () => {
  it("shows the default rate filled in while untouched", () => {
    expect(rateFieldText("", "5,41", null)).toBe("5,41");
  });
  it("shows what was typed", () => {
    expect(rateFieldText("5,5", "5,41", "5,41")).toBe("5,5");
  });
  it("lets the field be cleared after an edit", () => {
    expect(rateFieldText("", "5,41", "5,41")).toBe("");
  });
  it("fills in again when the default changes (another currency)", () => {
    expect(rateFieldText("", "6,20", "5,41")).toBe("6,20");
  });
});
