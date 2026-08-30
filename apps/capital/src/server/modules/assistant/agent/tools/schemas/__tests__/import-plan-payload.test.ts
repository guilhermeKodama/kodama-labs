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
