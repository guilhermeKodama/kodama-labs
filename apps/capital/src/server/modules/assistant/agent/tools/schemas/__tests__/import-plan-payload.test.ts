import { describe, it, expect } from "vitest";
import {
  ImportPlanPayloadSchema,
  hashPlanPayload,
  computePlanSummary,
} from "../import-plan-payload";

function basePayload() {
  return ImportPlanPayloadSchema.parse({
    entityType: "personal",
    entityId: "pa_1",
    fileId: "file_1",
    currency: "BRL",
    transactions: [
      { externalId: "a", date: "2026-03-01", description: "Salary", amount: 5000, type: "income" },
      { externalId: "b", date: "2026-03-02", description: "Rent", amount: 1500, type: "expense" },
    ],
    duplicateDecisions: [
      { externalId: "c", resolution: "skip_duplicate" },
      { externalId: "d", resolution: "link_fuzzy", existingTransactionId: "tx_9" },
    ],
  });
}

describe("hashPlanPayload", () => {
  it("is deterministic for the same validated payload", () => {
    const a = hashPlanPayload(basePayload());
    const b = hashPlanPayload(basePayload());
    expect(a).toBe(b);
  });

  it("changes when the payload changes", () => {
    const a = hashPlanPayload(basePayload());
    const changed = basePayload();
    changed.transactions[0]!.amount = 5001;
    const b = hashPlanPayload(changed);
    expect(a).not.toBe(b);
  });

  it("is stable regardless of input key order (zod normalizes to schema order)", () => {
    const p1 = ImportPlanPayloadSchema.parse({
      entityType: "personal",
      entityId: "pa_1",
      currency: "BRL",
      transactions: [],
    });
    const p2 = ImportPlanPayloadSchema.parse({
      currency: "BRL",
      entityId: "pa_1",
      entityType: "personal",
      transactions: [],
    });
    expect(hashPlanPayload(p1)).toBe(hashPlanPayload(p2));
  });
});

describe("computePlanSummary", () => {
  it("counts new transactions and splits income/expense totals", () => {
    const summary = computePlanSummary(basePayload());
    expect(summary.newTransactionCount).toBe(2);
    expect(summary.totalIncome).toBe(5000);
    expect(summary.totalExpense).toBe(1500);
  });

  it("splits duplicateDecisions by resolution", () => {
    const summary = computePlanSummary(basePayload());
    expect(summary.skipDuplicateCount).toBe(1);
    expect(summary.linkFuzzyCount).toBe(1);
  });

  it("counts transferReconciliations", () => {
    const payload = ImportPlanPayloadSchema.parse({
      entityType: "personal",
      entityId: "pa_1",
      currency: "BRL",
      transferReconciliations: [
        {
          existingTransferId: "tr_1",
          externalId: "ext_1",
          updates: { amount: 250, description: "Corrected" },
        },
      ],
    });
    const summary = computePlanSummary(payload);
    expect(summary.transferReconciliationCount).toBe(1);
  });

  it("rounds totals to cents", () => {
    const payload = ImportPlanPayloadSchema.parse({
      entityType: "personal",
      entityId: "pa_1",
      currency: "BRL",
      transactions: [
        { externalId: "a", date: "2026-03-01", description: "x", amount: 10.003, type: "income" },
        { externalId: "b", date: "2026-03-01", description: "y", amount: 0.004, type: "income" },
      ],
    });
    const summary = computePlanSummary(payload);
    expect(summary.totalIncome).toBe(10.01);
  });
});

describe("ImportPlanTransferSchema flow", () => {
  const transfer = {
    externalId: "t1",
    date: "2026-03-03",
    amount: 800,
    flow: "outflow",
    direction: "capital_injection",
    counterpartyEntityType: "business",
    counterpartyEntityId: "biz_1",
  };

  // A transfer with no stated flow is exactly the plan that used to be
  // accepted and then have its direction guessed from the label.
  it("refuses a transfer that does not say which way the money went", () => {
    const withoutFlow: Record<string, unknown> = { ...transfer };
    delete withoutFlow.flow;
    expect(() =>
      ImportPlanPayloadSchema.parse({
        entityType: "personal",
        entityId: "pa_1",
        currency: "BRL",
        transfers: [withoutFlow],
      })
    ).toThrow();
  });

  it("refuses a flow that is neither an outflow nor an inflow", () => {
    expect(() =>
      ImportPlanPayloadSchema.parse({
        entityType: "personal",
        entityId: "pa_1",
        currency: "BRL",
        transfers: [{ ...transfer, flow: "incoming" }],
      })
    ).toThrow();
  });
});

describe("computePlanSummary transfer totals", () => {
  it("splits transfers into what leaves and what arrives", () => {
    const payload = ImportPlanPayloadSchema.parse({
      entityType: "personal",
      entityId: "pa_1",
      currency: "BRL",
      transfers: [
        {
          externalId: "t1", date: "2026-03-03", amount: 800, flow: "outflow",
          direction: "capital_injection", counterpartyEntityType: "business", counterpartyEntityId: "biz_1",
        },
        {
          externalId: "t2", date: "2026-03-04", amount: 200, flow: "inflow",
          direction: "profit_distribution", counterpartyEntityType: "business", counterpartyEntityId: "biz_1",
        },
      ],
      investmentTransfers: [
        { externalId: "t3", date: "2026-03-05", amount: 50, direction: "investment_deposit", investmentAccountId: "inv_1" },
        { externalId: "t4", date: "2026-03-06", amount: 25, direction: "investment_withdrawal", investmentAccountId: "inv_1" },
      ],
    });
    const summary = computePlanSummary(payload);
    expect(summary.transferOutflow).toBe(850);
    expect(summary.transferInflow).toBe(225);
    expect(summary.transferCount).toBe(4);
  });
});

describe("computePlanSummary card bill and payments", () => {
  const plan = (overrides: Record<string, unknown>) =>
    ImportPlanPayloadSchema.parse({ entityType: "personal", entityId: "pa_1", currency: "BRL", ...overrides });

  it("counts the bill rows, their net total (refunds negative) and the rules they would teach", () => {
    const summary = computePlanSummary(
      plan({
        transactions: [
          { externalId: "a", date: "2026-03-01", description: "Mercado", amount: 30, type: "expense", categoryId: "cat_1", createRule: true },
          { externalId: "b", date: "2026-03-02", description: "Padaria", amount: 10, type: "expense", createRule: true },
        ],
        cardPayments: [{ externalId: "p1", date: "2026-03-10", amount: 300, cardAccountId: "card_1" }],
        cardStatement: {
          month: "2026-03",
          rows: [
            { date: "2026-02-20", description: "LOJA", amount: 100.1, categoryId: "cat_2", createRule: true },
            { date: "2026-02-21", description: "ESTORNO", amount: -20.05 },
            { date: "2026-02-22", description: "CINEMA", amount: 40, categoryId: "cat_3" },
          ],
        },
      })
    );
    expect(summary).toMatchObject({ cardPaymentCount: 1, cardRowCount: 3, cardRowTotal: 120.05 });
    // A rule needs both createRule and a category: the "Padaria" row and the cinema row teach nothing.
    expect(summary.rulesToCreate).toBe(2);
  });

  it("counts none of it for a plan that has no card statement or payments", () => {
    const summary = computePlanSummary(plan({}));
    expect(summary).toMatchObject({ cardPaymentCount: 0, cardRowCount: 0, cardRowTotal: 0, rulesToCreate: 0, billCount: 0 });
  });

  it("previews the bills a plan would import", () => {
    const summary = computePlanSummary(
      plan({
        bills: [
          { fileId: "f1", creditCardId: "card_1", closingDate: "2026-03-05", dueDate: "2026-03-12", previewTotalAmount: 100.505, previewTransactionCount: 3 },
          { fileId: "f2", newCreditCard: { bankName: "Inter", lastFourDigits: "1234", closingDay: 5, dueDay: 12, currency: "BRL" }, closingDate: "2026-03-05", dueDate: "2026-03-12", previewTotalAmount: 50, previewTransactionCount: 2 },
        ],
        creditCards: [{ bankName: "Inter", lastFourDigits: "1234", closingDay: 5, dueDay: 12, currency: "BRL" }],
      })
    );
    expect(summary).toMatchObject({ billCount: 2, billTransactionPreviewCount: 5, billTotalPreviewAmount: 150.51, creditCardCount: 1 });
  });
});
