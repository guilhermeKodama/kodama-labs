import { describe, expect, it } from "vitest";
import type { AccountRecord } from "@/lib/api/catalog";
import {
  accountForEntity,
  accountHint,
  buildImportPlan,
  canCommit,
  decodeUse,
  effectiveStatus,
  encodeUse,
  filterRows,
  initialDecisions,
  learnsRule,
  pickUse,
  reviewSummary,
  setIncluded,
  statementMonthParts,
  statusCounts,
  transferDirection,
  type AnalyzedImportRow,
  type ImportAnalysis,
  type PlanContext,
} from "../review";

const row = (over: Partial<AnalyzedImportRow> & Pick<AnalyzedImportRow, "id">): AnalyzedImportRow => ({
  externalId: over.id,
  date: "2026-09-02",
  description: "UBER *TRIP",
  amount: -23.4,
  type: "expense",
  kind: "entry",
  status: "need",
  duplicateOf: null,
  suggestedCategoryId: null,
  source: null,
  ruleId: null,
  rulePattern: null,
  ...over,
});

const analysis = (over: Partial<ImportAnalysis>): ImportAnalysis => ({
  kind: "bank_ofx",
  files: [{ name: "extrato.ofx", size: 1800, kind: "bank_ofx" }],
  fileName: "extrato.ofx",
  bank: "Nubank",
  currency: "BRL",
  period: { from: "2026-09-01", to: "2026-09-15" },
  count: 0,
  externalAccountId: "98765-4",
  suggestedAccountId: "acc-bank",
  accountMatch: "number",
  entityId: "pf",
  ledgerBalance: 3157.8,
  payments: 0,
  card: null,
  rows: [],
  summary: { counts: { all: 0, dup: 0, rule: 0, ai: 0, need: 0 }, income: 0, expense: 0 },
  ai: { requested: true, available: false, used: false },
  ...over,
});

/** The statement of the server's import-dialog test: rule, need, income, fuzzy and exact duplicates, a bill payment. */
const BANK_ROWS: AnalyzedImportRow[] = [
  row({ id: "UBER", status: "rule", suggestedCategoryId: "transporte", source: "rule", ruleId: "r-uber", rulePattern: "uber", reconciliation: "new" }),
  row({ id: "PETZ", description: "PAG*PETZ", amount: -189.9, reconciliation: "new" }),
  row({ id: "SALARY", description: "Pix recebido - ACME", amount: 5000, type: "income", reconciliation: "new" }),
  row({ id: "IFOOD", description: "IFOOD *RESTAURANTE", amount: -86.9, status: "dup", reconciliation: "fuzzy_match", duplicateOf: { id: "e-ifood", description: "iFood", date: "2026-09-03" } }),
  row({ id: "ALREADY", description: "PADARIA", amount: -42, status: "dup", reconciliation: "duplicate", duplicateOf: { id: "e-padaria", description: "PADARIA", date: "2026-09-10" } }),
  row({
    id: "BILL",
    description: "Pagamento de fatura",
    amount: -1500,
    kind: "card_payment",
    status: "rule",
    source: "classification",
    reconciliation: "new",
    cardPayment: { cardAccountId: "card", statementMonth: "2026-09" },
  }),
];

const ctx: PlanContext = {
  entity: { id: "pf", kind: "personal" },
  accountId: "acc-bank",
  entityKinds: new Map([
    ["pf", "personal"],
    ["ltda", "business"],
  ]),
  currency: "BRL",
  linkPayment: true,
};

describe("review decisions and statuses", () => {
  it("starts with duplicates unchecked and the analysis' suggestions", () => {
    const d = initialDecisions(analysis({ rows: BANK_ROWS }));
    expect(d.UBER).toEqual({ include: true, use: { as: "category", categoryId: "transporte" }, picked: false });
    expect(d.IFOOD.include).toBe(false);
    expect(d.ALREADY.include).toBe(false);
    expect(d.BILL.use).toEqual({ as: "card_payment", cardAccountId: "card" });
    expect(statusCounts(BANK_ROWS, d)).toEqual({ all: 6, rule: 2, ai: 0, need: 2, dup: 2 });
  });

  it("turns a row without category into 'Regra aplicada' once one is picked, and filters by the shown status", () => {
    const petz = BANK_ROWS[1];
    let d = initialDecisions(analysis({ rows: BANK_ROWS }));
    expect(filterRows(BANK_ROWS, d, "need").map((r) => r.id)).toEqual(["PETZ", "SALARY"]);
    d = pickUse(d, petz, "cat:pet");
    expect(d.PETZ).toEqual({ include: true, use: { as: "category", categoryId: "pet" }, picked: true });
    expect(effectiveStatus(petz, d.PETZ)).toBe("rule");
    expect(filterRows(BANK_ROWS, d, "need").map((r) => r.id)).toEqual(["SALARY"]);
    expect(filterRows(BANK_ROWS, d, "rule").map((r) => r.id)).toEqual(["UBER", "PETZ", "BILL"]);
    expect(filterRows(BANK_ROWS, d, "all")).toHaveLength(6);
    // An unknown picker value changes nothing.
    expect(pickUse(d, petz, "nope")).toBe(d);
  });

  it("encodes the picker values both ways", () => {
    for (const use of [
      { as: "category", categoryId: "c1" },
      { as: "transfer", entityId: "ltda" },
      { as: "invest", accountId: "xp" },
      { as: "card_payment", cardAccountId: "card" },
    ] as const) {
      expect(decodeUse(encodeUse(use)!)).toEqual(use);
    }
    expect(encodeUse({ as: "category", categoryId: null })).toBeNull();
    expect(decodeUse("cat:")).toBeNull();
    expect(decodeUse("x:1")).toBeNull();
  });

  it("learns a rule only from a category the user picked that no rule gives already", () => {
    const [uber, petz] = BANK_ROWS;
    expect(learnsRule(petz, { include: true, use: { as: "category", categoryId: "pet" }, picked: true })).toBe(true);
    expect(learnsRule(petz, { include: false, use: { as: "category", categoryId: "pet" }, picked: true })).toBe(false);
    expect(learnsRule(petz, { include: true, use: { as: "category", categoryId: "pet" }, picked: false })).toBe(false);
    expect(learnsRule(uber, { include: true, use: { as: "category", categoryId: "transporte" }, picked: true })).toBe(false);
    expect(learnsRule(uber, { include: true, use: { as: "category", categoryId: "lazer" }, picked: true })).toBe(true);
    expect(learnsRule(petz, { include: true, use: { as: "transfer", entityId: "ltda" }, picked: true })).toBe(false);
  });
});

describe("reviewSummary (the confirm KPIs)", () => {
  it("counts imported and skipped rows, the signed total, distinct new rules and transfers", () => {
    const a = analysis({ rows: [...BANK_ROWS, row({ id: "PETZ2", description: "pag*petz ", amount: -10, reconciliation: "new" })] });
    let d = initialDecisions(a);
    d = pickUse(d, BANK_ROWS[1], "cat:pet");
    d = pickUse(d, a.rows[6], "cat:pet");
    d = setIncluded(d, BANK_ROWS[2], false);
    expect(reviewSummary(a.rows, d)).toEqual({ included: 4, ignored: 3, ignoredDuplicates: 2, total: -1723.3, rules: 1, transfers: 1 });
  });
});

describe("buildImportPlan (bank statement)", () => {
  it("books each row as reviewed: categories, rules, bill payment, duplicates linked or skipped", () => {
    const a = analysis({ rows: BANK_ROWS });
    let d = initialDecisions(a);
    d = pickUse(d, BANK_ROWS[1], "cat:pet");
    const plan = buildImportPlan(a, d, ctx);
    expect(plan).toMatchObject({
      entityType: "personal",
      entityId: "pf",
      accountId: "acc-bank",
      currency: "BRL",
      bankName: "Nubank",
      fileName: "extrato.ofx",
      ledgerBalance: 3157.8,
      transfers: [],
      investmentTransfers: [],
      reconciliations: [],
      creditCards: [],
      bills: [],
    });
    expect(plan.transactions).toEqual([
      { externalId: "UBER", date: "2026-09-02", amount: 23.4, description: "UBER *TRIP", type: "expense", categoryId: "transporte" },
      { externalId: "PETZ", date: "2026-09-02", amount: 189.9, description: "PAG*PETZ", type: "expense", categoryId: "pet", createRule: true },
      { externalId: "SALARY", date: "2026-09-02", amount: 5000, description: "Pix recebido - ACME", type: "income" },
    ]);
    expect(plan.cardPayments).toEqual([{ externalId: "BILL", date: "2026-09-02", amount: 1500, description: "Pagamento de fatura", cardAccountId: "card", statementMonth: "2026-09" }]);
    expect(plan.duplicateDecisions).toEqual([
      { externalId: "IFOOD", resolution: "link_fuzzy", existingTransactionId: "e-ifood" },
      { externalId: "ALREADY", resolution: "skip_duplicate" },
    ]);
    expect(plan.cardStatement).toBeUndefined();
  });

  it("imports checked duplicates anyway: an exact one again, a look-alike as new, a changed one updates its entry", () => {
    const changed = row({
      id: "CHANGED",
      description: "MERCADO",
      amount: -55,
      status: "dup",
      reconciliation: "changed",
      duplicateOf: { id: "e-mercado", description: "MERCADO", date: "2026-09-02" },
      diffs: [{ field: "amount", existingValue: "-50", ofxValue: "-55" }],
    });
    const a = analysis({ rows: [...BANK_ROWS, changed] });
    let d = initialDecisions(a);
    for (const r of a.rows) d = setIncluded(d, r, true);
    const plan = buildImportPlan(a, d, ctx);
    expect(plan.duplicateDecisions).toEqual([{ externalId: "ALREADY", resolution: "import_anyway" }]);
    expect(plan.transactions.map((t) => t.externalId)).toEqual(["UBER", "PETZ", "SALARY", "IFOOD", "ALREADY"]);
    expect(plan.reconciliations).toEqual([{ existingTransactionId: "e-mercado", externalId: "CHANGED", updates: { amount: 55 } }]);
  });

  it("books transfers to another entity, aportes and resgates, and leaves unchecked rows out", () => {
    const a = analysis({
      rows: [
        row({ id: "PIX-OUT", description: "Pix enviado KODAMA LTDA", amount: -1000, status: "need", reconciliation: "new" }),
        row({
          id: "PIX-IN",
          description: "Pix recebido KODAMA LTDA",
          amount: 2000,
          type: "income",
          kind: "transfer",
          status: "rule",
          source: "classification",
          reconciliation: "new",
          transfer: { suggestedEntityId: "ltda", suggestedEntityName: "Kodama LTDA", suggestedEntityType: "business", suggestedFlow: "inflow", suggestedDirection: "reimbursement" },
        }),
        row({ id: "XP-IN", description: "TED XP", amount: 300, type: "income", reconciliation: "new" }),
        row({ id: "XP-OUT", description: "Aplicação XP", amount: -500, kind: "investment_transfer", status: "rule", investment: { direction: "investment_deposit", accountId: "xp" }, reconciliation: "new" }),
        row({ id: "SKIP", description: "TARIFA", amount: -5, reconciliation: "new" }),
      ],
    });
    let d = initialDecisions(a);
    d = pickUse(d, a.rows[0], "tr:ltda");
    d = pickUse(d, a.rows[2], "inv:xp");
    d = setIncluded(d, a.rows[4], false);
    const plan = buildImportPlan(a, d, ctx);
    expect(plan.transfers).toEqual([
      { externalId: "PIX-OUT", date: "2026-09-02", amount: 1000, description: "Pix enviado KODAMA LTDA", flow: "outflow", direction: "capital_injection", counterpartyEntityType: "business", counterpartyEntityId: "ltda" },
      // The analysis' label for its own suggestion is kept.
      { externalId: "PIX-IN", date: "2026-09-02", amount: 2000, description: "Pix recebido KODAMA LTDA", flow: "inflow", direction: "reimbursement", counterpartyEntityType: "business", counterpartyEntityId: "ltda" },
    ]);
    expect(plan.investmentTransfers).toEqual([
      { externalId: "XP-IN", date: "2026-09-02", amount: 300, description: "TED XP", direction: "investment_withdrawal", investmentAccountId: "xp" },
      { externalId: "XP-OUT", date: "2026-09-02", amount: 500, description: "Aplicação XP", direction: "investment_deposit", investmentAccountId: "xp" },
    ]);
    expect(plan.transactions).toEqual([]);
    expect(plan.duplicateDecisions).toEqual([]);
    expect(plan.cardPayments).toBeUndefined();
  });

  it("labels transfers by who paid whom", () => {
    expect(transferDirection("outflow", "personal", "business")).toBe("capital_injection");
    expect(transferDirection("inflow", "personal", "business")).toBe("profit_distribution");
    expect(transferDirection("outflow", "business", "personal")).toBe("profit_distribution");
    expect(transferDirection("inflow", "business", "personal")).toBe("capital_injection");
    expect(transferDirection("outflow", "business", "business")).toBe("capital_injection");
  });
});

describe("buildImportPlan (card bill)", () => {
  const card = {
    accountId: "card",
    month: "2026-09",
    closingDate: "2026-09-03",
    dueDate: "2026-09-12",
    statementId: null,
    total: 288.2,
    existingCount: 1,
    paid: false,
    payFromAccountId: "acc-bank",
    payment: null,
  };
  const rows = [
    row({ id: "c0", externalId: null, description: "Uber *Trip", amount: -45.9, status: "dup", duplicateOf: { id: "e-uber", description: "Uber *Trip", date: "2026-08-10" } }),
    row({ id: "c1", externalId: null, description: "Estorno Amazon", amount: 20, type: "income" }),
    row({ id: "c2", externalId: null, description: "Loja Eletronicos", amount: -199, installment: { number: 2, total: 6 }, status: "ai", suggestedCategoryId: "casa", source: "ai" }),
    row({ id: "c3", externalId: null, description: "DROGASIL 1234", amount: -64.3 }),
  ];
  const a = analysis({ kind: "card_ofx", accountMatch: "number", suggestedAccountId: "card", card, rows, ledgerBalance: null });

  it("sends the checked rows to the statement with the statement's sign, categories and installments", () => {
    let d = initialDecisions(a);
    d = pickUse(d, rows[3], "cat:saude");
    const plan = buildImportPlan(a, d, { ...ctx, accountId: "card" });
    expect(plan.transactions).toEqual([]);
    expect(plan.ledgerBalance).toBeUndefined();
    expect(plan.cardStatement).toEqual({
      month: "2026-09",
      closingDate: "2026-09-03",
      dueDate: "2026-09-12",
      total: 288.2,
      linkPayment: true,
      rows: [
        { date: "2026-09-02", description: "Estorno Amazon", amount: -20 },
        { date: "2026-09-02", description: "Loja Eletronicos", amount: 199, categoryId: "casa", installment: { number: 2, total: 6 } },
        { date: "2026-09-02", description: "DROGASIL 1234", amount: 64.3, categoryId: "saude", createRule: true },
      ],
    });
  });

  it("books a checked duplicate anyway, and honours an unchecked payment link", () => {
    const d = setIncluded(initialDecisions(a), rows[0], true);
    const plan = buildImportPlan(a, d, { ...ctx, accountId: "card", linkPayment: false });
    expect(plan.cardStatement?.rows[0]).toEqual({ date: "2026-09-02", description: "Uber *Trip", amount: 45.9, allowDuplicate: true });
    expect(plan.cardStatement?.linkPayment).toBe(false);
  });

  it("can be committed only with an account and, for a card, its statement", () => {
    expect(canCommit(a, "card")).toBe(true);
    expect(canCommit(a, null)).toBe(false);
    expect(canCommit({ ...a, card: null }, "card")).toBe(false);
    expect(canCommit(analysis({ rows: BANK_ROWS }), "acc-bank")).toBe(true);
    expect(canCommit(analysis({ rows: [] }), "acc-bank")).toBe(false);
    expect(canCommit(analysis({ kind: "pdf", viaAssistant: true }), "acc-bank")).toBe(false);
    expect(canCommit(null, "acc-bank")).toBe(false);
  });
});

describe("account and entity", () => {
  const account = (over: Partial<AccountRecord> & Pick<AccountRecord, "id" | "entityId" | "type">): AccountRecord => ({
    name: over.id,
    currency: "BRL",
    institution: null,
    externalId: null,
    balance: 0,
    isDefault: false,
    creditLimit: null,
    closingDay: null,
    dueDay: null,
    payFromAccountId: null,
    archivedAt: null,
    ...over,
  });
  const accounts = [
    account({ id: "pf-cash", entityId: "pf", type: "cash" }),
    account({ id: "pf-main", entityId: "pf", type: "checking", isDefault: true }),
    account({ id: "pf-card", entityId: "pf", type: "credit_card" }),
    account({ id: "ltda-old", entityId: "ltda", type: "checking", archivedAt: "2026-01-01" }),
    account({ id: "ltda-card", entityId: "ltda", type: "credit_card" }),
  ];

  it("picks the entity's main account of the file's kind, else its first, else none", () => {
    expect(accountForEntity(accounts, "pf", "bank_ofx")).toBe("pf-main");
    expect(accountForEntity(accounts, "pf", "card_csv")).toBe("pf-card");
    expect(accountForEntity(accounts, "ltda", "card_ofx")).toBe("ltda-card");
    expect(accountForEntity(accounts, "ltda", "bank_ofx")).toBeNull();
  });

  it("explains how the account was found, or asks for one", () => {
    expect(accountHint("card_ofx", "number", "card")).toBe("cardNumber");
    expect(accountHint("bank_ofx", "number", "acc")).toBe("accountNumber");
    expect(accountHint("bank_ofx", "default", "acc")).toBe("default");
    expect(accountHint("bank_ofx", "explicit", "acc")).toBeNull();
    expect(accountHint("card_csv", null, null)).toBe("chooseCard");
    expect(accountHint("bank_ofx", "bank", null)).toBe("chooseAccount");
  });

  it("splits a statement month for its short label", () => {
    expect(statementMonthParts("2026-09")).toEqual({ month: 9, yy: "26" });
  });
});
