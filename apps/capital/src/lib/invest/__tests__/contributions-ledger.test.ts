import { describe, expect, it } from "vitest";
import type { LedgerDisplayRow } from "@capital/server/modules/ledger/contracts";
import { contributionRow, contributionsQuery, contributionTotals, EMPTY_CONTRIBUTION_FILTERS } from "../contributions-ledger";

function row(over: Partial<LedgerDisplayRow>): LedgerDisplayRow {
  return {
    id: "e1",
    date: "2026-09-05",
    effectiveDate: "2026-09-05",
    description: "Aporte",
    notes: null,
    kind: "transfer",
    amount: -1000,
    currency: "BRL",
    exchangeRate: 1,
    amountBase: -1000,
    entityId: "pf",
    accountId: "nubank",
    accountType: "checking",
    categoryId: null,
    isTaxDeductible: false,
    isRecurring: false,
    transferGroupId: "g1",
    transferDirection: "investment_deposit",
    counterpartAccountId: "xp",
    cardStatementId: null,
    installmentPlanId: null,
    installmentNumber: null,
    recurringRuleId: null,
    importId: null,
    deletedAt: null,
    legIds: ["e1", "e2"],
    flowKind: "invest",
    counts: true,
    displayAmount: -1000,
    neutral: false,
    counterpartEntityId: "pf",
    installmentTotal: null,
    linkedOperationId: null,
    operationType: null,
    attachmentCount: 0,
    ...over,
  };
}

describe("contributionsQuery", () => {
  it("reads every aporte and resgate in display mode, newest first, paged", () => {
    const q = contributionsQuery(EMPTY_CONTRIBUTION_FILTERS);
    expect(q.body).toMatchObject({
      semantics: "display",
      period: { preset: "all", offset: 0 },
      filters: [{ field: "transferDirection", op: "in", values: ["investment_deposit", "investment_withdrawal"] }],
      sort: [{ field: "date", dir: "desc" }],
      page: { limit: 50 },
    });
    expect(q.body).not.toHaveProperty("search");
    expect(q.clientFilter).toBeNull();
    // The export reads the same selection.
    expect(q.selection).toEqual({ period: q.body.period, filters: q.body.filters });
  });

  it("maps Tipo, Entidade, Conta, Período and the search to ledger filters", () => {
    const q = contributionsQuery({ ...EMPTY_CONTRIBUTION_FILTERS, directions: ["investment_withdrawal"], entityIds: ["pj"], accountIds: ["nubank"], period: "ytd", search: "  salário " });
    expect(q.body.filters).toEqual([
      { field: "transferDirection", op: "in", values: ["investment_withdrawal"] },
      { field: "entityId", op: "in", values: ["pj"] },
      { field: "accountId", op: "in", values: ["nubank"] },
    ]);
    expect(q.body).toMatchObject({ period: { preset: "ytd", offset: 0 }, search: "salário" });
    expect(q.clientFilter).toBeNull();
  });

  it("with Conta and Corretora together keeps the broker legs and matches the bank side on the counterpart", () => {
    const q = contributionsQuery({ ...EMPTY_CONTRIBUTION_FILTERS, accountIds: ["nubank"], brokerIds: ["xp"] });
    expect(q.selection.filters.filter((f) => f.field === "accountId")).toEqual([{ field: "accountId", op: "in", values: ["xp"] }]);
    const brokerLeg = { accountId: "xp", accountType: "brokerage" as const };
    expect(q.clientFilter!({ ...brokerLeg, counterpartAccountId: "nubank" })).toBe(true);
    expect(q.clientFilter!({ ...brokerLeg, counterpartAccountId: "itau" })).toBe(false);
  });
});

describe("contributionRow", () => {
  it("signs by direction whichever leg stands for the transfer (+ aporte, − resgate)", () => {
    // Both legs selected: the bank leg stands for the aporte.
    expect(contributionRow(row({}))).toMatchObject({ direction: "investment_deposit", brokerAccountId: "xp", otherAccountId: "nubank", amount: 1000 });
    // A Corretora filter keeps the broker leg (+1000 on the broker).
    expect(contributionRow(row({ accountId: "xp", accountType: "brokerage", counterpartAccountId: "nubank", amountBase: 1000 }))).toMatchObject({
      brokerAccountId: "xp",
      otherAccountId: "nubank",
      amount: 1000,
    });
    const resgate = contributionRow(row({ transferDirection: "investment_withdrawal", accountId: "nubank", counterpartAccountId: "xp", amountBase: 400 }));
    expect(resgate).toMatchObject({ direction: "investment_withdrawal", brokerAccountId: "xp", otherAccountId: "nubank", amount: -400 });
  });

  it("sums aportes and resgates apart", () => {
    expect(contributionTotals([{ amount: 1000 }, { amount: -400 }, { amount: 250.5 }])).toEqual({ deposits: 1250.5, withdrawals: 400, net: 850.5 });
  });
});
