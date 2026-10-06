import { describe, expect, it } from "vitest";
import { cleanQuickAddDraft, decodeCreateParam, encodeCreateParam, parseQuickAdd, type QuickAddCatalog } from "@/lib/ledger/quick-add";

const catalog: QuickAddCatalog = {
  accounts: [
    { id: "nubank", name: "Nubank", entityId: "pf", type: "checking", currency: "BRL", isDefault: true },
    { id: "nubank-card", name: "Nubank · cartão", entityId: "pf", type: "credit_card", currency: "BRL" },
    { id: "xp-card", name: "XP · cartão", entityId: "pf", type: "credit_card", currency: "BRL" },
    { id: "xp", name: "XP", entityId: "pf", type: "brokerage", currency: "BRL" },
    { id: "inter", name: "Inter PJ", entityId: "ltda", type: "checking", currency: "BRL", isDefault: true },
    { id: "mercury", name: "Mercury", entityId: "llc", type: "checking", currency: "USD", isDefault: true },
    { id: "mercury-card", name: "Mercury · cartão", entityId: "llc", type: "credit_card", currency: "USD" },
  ],
  entities: [
    { id: "pf", name: "Guilherme", kind: "personal" },
    { id: "ltda", name: "Kodama LTDA", kind: "business" },
    { id: "llc", name: "Kodama LLC", kind: "business" },
  ],
  categories: [
    { id: "mercado", name: "Mercado", type: "expense" },
    { id: "saude", name: "Saúde", type: "expense" },
    { id: "servicos", name: "Receita de serviços", type: "income" },
  ],
  currencies: ["BRL", "USD", "EUR"],
};

const TODAY = "2026-09-22";
const parse = (text: string) => parseQuickAdd(text, catalog, TODAY);

describe("parseQuickAdd", () => {
  it("reads the mockup's example: amount, card for an expense, yesterday, capitalised description", () => {
    expect(parse("ifood 86,90 nubank ontem")).toEqual({
      draft: { amount: 86.9, kind: "expense", accountId: "nubank-card", entityId: "pf", date: "2026-09-21", description: "Ifood" },
      tokens: [
        { field: "amount", text: "86,90" },
        { field: "account", text: "nubank" },
        { field: "date", text: "ontem" },
        { field: "description", text: "Ifood" },
      ],
    });
  });

  it("takes a currency and an entity's main account (aws 222,60 usd llc)", () => {
    const { draft, tokens } = parse("aws 222,60 usd llc");
    expect(draft).toEqual({ amount: 222.6, kind: "expense", entityId: "llc", accountId: "mercury", description: "Aws" });
    expect(tokens.map((token) => token.field)).toEqual(["amount", "currency", "entity", "description"]);
  });

  it("keeps a currency that differs from the account's", () => {
    expect(parse("hotel 120 eur nubank").draft).toMatchObject({ currency: "EUR", accountId: "nubank-card" });
    expect(parse("figma 20 us$").draft).toMatchObject({ currency: "USD", amount: 20 });
  });

  it("makes a leading + income and picks the checking account (+5000 invoice acme mercury)", () => {
    const { draft, tokens } = parse("+5000 invoice acme mercury");
    expect(draft).toEqual({ amount: 5000, kind: "income", accountId: "mercury", entityId: "llc", description: "Invoice Acme" });
    expect(tokens.slice(0, 2)).toEqual([
      { field: "amount", text: "+5000" },
      { field: "kind", text: "+" },
    ]);
  });

  it("finds a category after # (accents ignored) or keeps the name to create", () => {
    expect(parse("mercado #mercado 45").draft).toEqual({ description: "Mercado", categoryId: "mercado", amount: 45, kind: "expense" });
    expect(parse("consulta 300 #saude").draft.categoryId).toBe("saude");
    expect(parse("ração 89 #pets").draft).toMatchObject({ categoryName: "Pets", description: "Ração" });
    expect(parse("+800 freela #receita").draft.categoryId).toBe("servicos");
  });

  it("reads grouped and dotted amounts", () => {
    expect(parse("1.234,56 aluguel").draft).toMatchObject({ amount: 1234.56, description: "Aluguel" });
    expect(parse("uber 23.40").draft.amount).toBe(23.4);
    expect(parse("1,234.50 rent").draft.amount).toBe(1234.5);
  });

  it("takes only the first number as the amount", () => {
    expect(parse("invoice 0142 5000").draft).toMatchObject({ amount: 142, description: "Invoice 5000" });
  });

  it("reads day/month dates, last year when this year's would be in the future", () => {
    expect(parse("uber 23,40 21/09").draft.date).toBe("2026-09-21");
    expect(parse("uber 23,40 25/12").draft.date).toBe("2025-12-25");
    expect(parse("uber 23,40 05/01/2026").draft.date).toBe("2026-01-05");
    expect(parse("uber 23,40 hoje").draft.date).toBe(TODAY);
    expect(parse("uber 31/02").draft).toEqual({ description: "Uber 31/02" });
  });

  it("matches a whole account name over several words and pf/pj/ltda entities", () => {
    expect(parse("anuidade 50 nubank cartão").draft.accountId).toBe("nubank-card");
    expect(parse("+300 reembolso nubank").draft.accountId).toBe("nubank");
    expect(parse("contador 900 pj").draft).toMatchObject({ entityId: "ltda", accountId: "inter" });
    expect(parse("padaria 12 pf").draft).toMatchObject({ entityId: "pf", accountId: "nubank" });
    expect(parse("contador 900 ltda").draft.entityId).toBe("ltda");
  });

  it("never picks a brokerage account (aportes have their own form)", () => {
    expect(parse("cafe 10 xp").draft.accountId).toBe("xp-card");
  });

  it("prefers an account of the typed entity when a word names several", () => {
    expect(parse("taxa 10 mercury llc").draft.accountId).toBe("mercury-card");
  });

  it("keeps a generic word that only starts an account name in the description (every entity has a “Conta principal”)", () => {
    const withMain: QuickAddCatalog = {
      ...catalog,
      accounts: [
        ...catalog.accounts,
        { id: "pf-main", name: "Conta principal", entityId: "pf", type: "checking", currency: "BRL" },
        { id: "ltda-main", name: "Conta principal", entityId: "ltda", type: "checking", currency: "BRL" },
      ],
    };
    const quick = (text: string) => parseQuickAdd(text, withMain, TODAY);
    expect(quick("conta de luz 120").draft).toEqual({ amount: 120, kind: "expense", description: "Conta De Luz" });
    expect(quick("conta de luz 120 nubank").draft).toMatchObject({ description: "Conta De Luz", accountId: "nubank-card" });
    // The whole name still names the account (the typed entity picks which one).
    expect(quick("aluguel 2500 conta principal pj").draft).toMatchObject({ accountId: "ltda-main", description: "Aluguel" });
  });

  it("returns nothing for blank text", () => {
    expect(parse("   ")).toEqual({ draft: {}, tokens: [] });
  });
});

describe("create param", () => {
  it("opens a blank form with 1 and a prefilled one with JSON", () => {
    expect(encodeCreateParam()).toBe("1");
    expect(encodeCreateParam({ description: "", amount: undefined })).toBe("1");
    const draft = { description: "iFood", amount: 86.9, kind: "expense" as const, accountId: "nubank", date: "2026-09-21" };
    expect(decodeCreateParam(encodeCreateParam(draft))).toEqual(draft);
  });

  it("is closed without the param and blank for anything unreadable", () => {
    expect(decodeCreateParam(null)).toBeNull();
    expect(decodeCreateParam(undefined)).toBeNull();
    expect(decodeCreateParam("")).toEqual({});
    expect(decodeCreateParam("1")).toEqual({});
    expect(decodeCreateParam("{oops")).toEqual({});
  });

  it("reads the JSON the old ⌘K wrote", () => {
    expect(decodeCreateParam(JSON.stringify({ description: "Uber", amount: 23.4, date: "2026-09-22" }))).toEqual({
      description: "Uber",
      amount: 23.4,
      date: "2026-09-22",
    });
  });

  it("keeps only well-formed fields", () => {
    expect(
      cleanQuickAddDraft({ description: " Uber ", amount: -3, kind: "gift", date: "21/09", currency: "USD", categoryName: "Pets", extra: 1 }),
    ).toEqual({ description: "Uber", currency: "USD", categoryName: "Pets" });
    expect(cleanQuickAddDraft([1])).toEqual({});
    expect(cleanQuickAddDraft({ amount: Number.NaN })).toEqual({});
  });
});
