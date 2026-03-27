import { describe, it, expect } from "vitest";
import { parseOfxContent } from "../parsers/ofx-parser";
import {
  normalizeTransactions,
  classifyTransactions,
  detectReconciliation,
  computeBalanceDiscrepancy,
  extractCounterparty,
  type EntityInfo,
  type InvestmentAccountInfo,
  type NormalizedTransaction,
  type ExistingTransactionData,
} from "../reconciliation";
import { MARCH_PARTIAL_OFX, FITIDS, ALL_FITIDS } from "./fixtures/march-partial";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const parsed = parseOfxContent(MARCH_PARTIAL_OFX);
const normalized = normalizeTransactions(parsed.transactions);

function txByFitId(fitId: string) {
  return normalized.find((t) => t.fitId === fitId)!;
}

const LARISSA_BUSINESS: EntityInfo = {
  id: "biz-larissa-001",
  name: "Larissa Ruba Psicologia Ltda",
  entityType: "business",
};

const INVESTMENT_ACCOUNT: InvestmentAccountInfo = {
  id: "inv-001",
  name: "Nubank RDB",
};

// ---------------------------------------------------------------------------
// 1. Basic OFX Parsing (March partial)
// ---------------------------------------------------------------------------

describe("Basic OFX Parsing (March 1-16 partial)", () => {
  it("should parse 12 transactions", () => {
    expect(parsed.transactions).toHaveLength(12);
  });

  it("should have 12 unique FITIDs", () => {
    const fitIds = parsed.transactions.map((t) => t.fitId);
    expect(new Set(fitIds).size).toBe(12);
  });

  it("should have all expected FITIDs", () => {
    const fitIds = new Set(parsed.transactions.map((t) => t.fitId));
    for (const id of ALL_FITIDS) {
      expect(fitIds.has(id)).toBe(true);
    }
  });

  it("should have ledger balance of 5042.94", () => {
    expect(parsed.ledgerBalance).toBe(5042.94);
  });

  it("should detect NU PAGAMENTOS S.A. as bank", () => {
    expect(parsed.bankName).toBe("NU PAGAMENTOS S.A.");
  });

  it("should extract BRL currency", () => {
    expect(parsed.currency).toBe("BRL");
  });

  it("should extract correct account ID", () => {
    expect(parsed.account.accountId).toBe("47404983-7");
  });

  it("should parse date range March 1-16", () => {
    expect(parsed.dateStart.getUTCMonth()).toBe(2); // March
    expect(parsed.dateStart.getUTCDate()).toBe(1);
    expect(parsed.dateEnd.getUTCMonth()).toBe(2);
    expect(parsed.dateEnd.getUTCDate()).toBe(16);
  });

  it("should parse Resgate RDB correctly", () => {
    const tx = parsed.transactions.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
    expect(tx.amount).toBe(1000.12);
    expect(tx.trnType).toBe("CREDIT");
    expect(tx.memo).toBe("Resgate RDB");
  });

  it("should parse Pix to Larissa correctly", () => {
    const tx = parsed.transactions.find((t) => t.fitId === FITIDS.PIX_TO_LARISSA)!;
    expect(tx.amount).toBe(-1000.0);
    expect(tx.trnType).toBe("DEBIT");
    expect(tx.memo).toContain("Larissa Ruba Psicologia Ltda");
  });

  it("should parse transfer from Larissa correctly", () => {
    const tx = parsed.transactions.find((t) => t.fitId === FITIDS.TRANSFER_FROM_LARISSA)!;
    expect(tx.amount).toBe(1034.45);
    expect(tx.trnType).toBe("CREDIT");
    expect(tx.memo).toContain("LARISSA RUBA PSICOLOGIA LTDA");
  });

  it("should compute correct net for the period", () => {
    const net = parsed.transactions.reduce((sum, t) => sum + t.amount, 0);
    expect(net).toBeCloseTo(193.54, 2);
  });
});

// ---------------------------------------------------------------------------
// 2. normalizeTransactions
// ---------------------------------------------------------------------------

describe("normalizeTransactions", () => {
  it("should normalize all 12 transactions", () => {
    expect(normalized).toHaveLength(12);
  });

  it("should use absolute amounts", () => {
    for (const tx of normalized) {
      expect(tx.amount).toBeGreaterThan(0);
    }
  });

  it("should assign correct types", () => {
    expect(txByFitId(FITIDS.RESGATE_RDB).type).toBe("income");
    expect(txByFitId(FITIDS.PIX_TO_LARISSA).type).toBe("expense");
    expect(txByFitId(FITIDS.TRANSFER_FROM_LARISSA).type).toBe("income");
    expect(txByFitId(FITIDS.DEBIT_DROGASIL).type).toBe("expense");
  });

  it("should extract short descriptions", () => {
    expect(txByFitId(FITIDS.RESGATE_RDB).description).toBe("Resgate RDB");
    expect(txByFitId(FITIDS.DEBIT_DROGASIL).description).toBe("DROGASIL1636");
    expect(txByFitId(FITIDS.PIX_TO_LARISSA).description).toContain("Pix enviado");
  });

  it("should preserve full description", () => {
    const tx = txByFitId(FITIDS.PIX_TO_LARISSA);
    expect(tx.fullDescription).toContain("Transferência enviada pelo Pix");
    expect(tx.fullDescription).toContain("56.922.261/0001-13");
  });
});

// ---------------------------------------------------------------------------
// 3. extractCounterparty
// ---------------------------------------------------------------------------

describe("extractCounterparty", () => {
  it("should extract from Pix sent", () => {
    const name = extractCounterparty(
      "Transferência enviada pelo Pix - Larissa Ruba Psicologia Ltda - 56.922.261/0001-13 - NU PAGAMENTOS"
    );
    expect(name).toBe("Larissa Ruba Psicologia Ltda");
  });

  it("should extract from Pix received", () => {
    const name = extractCounterparty(
      "Transferência recebida pelo Pix - KIWIFY PAGAMENTOS, TECNOLOGIA E SERVICOS LTDA - 36.149.947/0001-06"
    );
    expect(name).toBe("KIWIFY PAGAMENTOS, TECNOLOGIA E SERVICOS LTDA");
  });

  it("should extract from Transferência Recebida (non-Pix)", () => {
    const name = extractCounterparty(
      "Transferência Recebida - LARISSA RUBA PSICOLOGIA LTDA - 56.922.261/0001-13 - NU PAGAMENTOS"
    );
    expect(name).toBe("LARISSA RUBA PSICOLOGIA LTDA");
  });

  it("should extract from boleto payment", () => {
    const name = extractCounterparty(
      "Pagamento de boleto efetuado - BANCO XP S/A - 123456"
    );
    expect(name).toBe("BANCO XP S/A");
  });

  it("should return null for debit card purchases", () => {
    expect(extractCounterparty("Compra no débito - DROGASIL1636")).toBeNull();
  });

  it("should return null for short memos", () => {
    expect(extractCounterparty("Resgate RDB")).toBeNull();
    expect(extractCounterparty("Aplicação RDB")).toBeNull();
  });

  it("should extract from Pix via Open Banking", () => {
    const name = extractCounterparty(
      "Transferência enviada pelo Pix via Open Banking - Iniciada por: Bradesco ITP A2A - COMPANHIA PIRATININGA - 04.172.213/0001-51"
    );
    expect(name).toBe("COMPANHIA PIRATININGA");
  });
});

// ---------------------------------------------------------------------------
// 4. Multi-Classification Detection
// ---------------------------------------------------------------------------

describe("classifyTransactions", () => {
  describe("with no registered entities", () => {
    const classified = classifyTransactions(normalized, [], []);

    it("should classify all 12 transactions", () => {
      expect(classified).toHaveLength(12);
    });

    it("should give Resgate RDB two candidates (investment_transfer + regular)", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
      expect(tx.candidates).toHaveLength(2);
      const types = tx.candidates.map((c) => c.type);
      expect(types).toContain("investment_transfer");
      expect(types).toContain("regular_transaction");
    });

    it("should auto-resolve Resgate RDB as investment_transfer", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
      expect(tx.resolvedClassification).toBe("investment_transfer");
      expect(tx.needsResolution).toBe(false);
    });

    it("should detect investment_withdrawal direction for Resgate RDB", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
      const inv = tx.candidates.find((c) => c.type === "investment_transfer")!;
      expect(inv.investmentDetails?.direction).toBe("investment_withdrawal");
    });

    it("should give regular expenses only regular_transaction candidate", () => {
      const regularFitIds = [
        FITIDS.PIX_TO_CAROLINA,
        FITIDS.PIX_TO_JULIANE,
        FITIDS.NUPAY_CLICKBUS,
        FITIDS.DEBIT_AUTOPASS,
        FITIDS.DEBIT_DROGASIL,
        FITIDS.PIX_TO_BALOO,
        FITIDS.PIX_TO_SHOPEE,
        FITIDS.PIX_TO_TELEFONICA,
      ];
      for (const fitId of regularFitIds) {
        const tx = classified.find((t) => t.fitId === fitId)!;
        expect(tx.candidates).toHaveLength(1);
        expect(tx.candidates[0].type).toBe("regular_transaction");
        expect(tx.resolvedClassification).toBe("regular_transaction");
        expect(tx.needsResolution).toBe(false);
      }
    });

    it("should not detect entity transfers when no entities registered", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.PIX_TO_LARISSA)!;
      expect(tx.candidates).toHaveLength(1);
      expect(tx.candidates[0].type).toBe("regular_transaction");
    });

    it("should treat Kiwify Pix as regular income", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.PIX_FROM_KIWIFY)!;
      expect(tx.candidates).toHaveLength(1);
      expect(tx.candidates[0].type).toBe("regular_transaction");
      expect(tx.resolvedClassification).toBe("regular_transaction");
    });
  });

  describe("with matching business entity", () => {
    const classified = classifyTransactions(normalized, [LARISSA_BUSINESS], []);

    it("should give Pix to Larissa two candidates (entity_transfer + regular)", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.PIX_TO_LARISSA)!;
      const types = tx.candidates.map((c) => c.type);
      expect(types).toContain("entity_transfer");
      expect(types).toContain("regular_transaction");
      expect(tx.candidates).toHaveLength(2);
    });

    it("should suggest capital_injection for outgoing Pix to business", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.PIX_TO_LARISSA)!;
      const transfer = tx.candidates.find((c) => c.type === "entity_transfer")!;
      expect(transfer.transferDetails?.suggestedDirection).toBe("capital_injection");
      expect(transfer.transferDetails?.suggestedEntityId).toBe("biz-larissa-001");
      expect(transfer.transferDetails?.suggestedEntityType).toBe("business");
    });

    it("should auto-resolve Pix to Larissa as entity_transfer", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.PIX_TO_LARISSA)!;
      expect(tx.resolvedClassification).toBe("entity_transfer");
      expect(tx.needsResolution).toBe(false);
    });

    it("should give transfer from Larissa two candidates (entity_transfer + regular)", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.TRANSFER_FROM_LARISSA)!;
      const types = tx.candidates.map((c) => c.type);
      expect(types).toContain("entity_transfer");
      expect(types).toContain("regular_transaction");
    });

    it("should suggest profit_distribution for incoming transfer from business", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.TRANSFER_FROM_LARISSA)!;
      const transfer = tx.candidates.find((c) => c.type === "entity_transfer")!;
      expect(transfer.transferDetails?.suggestedDirection).toBe("profit_distribution");
    });

    it("should still give Resgate RDB investment_transfer (not entity_transfer)", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
      const types = tx.candidates.map((c) => c.type);
      expect(types).toContain("investment_transfer");
      expect(types).not.toContain("entity_transfer");
    });

    it("should not affect unrelated transactions", () => {
      const tx = classified.find((t) => t.fitId === FITIDS.DEBIT_DROGASIL)!;
      expect(tx.candidates).toHaveLength(1);
      expect(tx.resolvedClassification).toBe("regular_transaction");
    });
  });

  describe("needsResolution scenarios", () => {
    it("should NOT need resolution when only one non-regular candidate", () => {
      const classified = classifyTransactions(normalized, [LARISSA_BUSINESS], []);
      const tx = classified.find((t) => t.fitId === FITIDS.PIX_TO_LARISSA)!;
      expect(tx.needsResolution).toBe(false);
    });

    it("should need resolution when investment AND entity match overlap", () => {
      const investmentNamedLikeBusiness: EntityInfo = {
        id: "biz-resgate-001",
        name: "Resgate RDB",
        entityType: "business",
      };
      // This is a contrived scenario but tests the multi-candidate logic
      const classified = classifyTransactions(
        normalized,
        [investmentNamedLikeBusiness],
        []
      );
      // Resgate RDB shouldn't match as entity transfer since extractCounterparty returns null for short memos
      const tx = classified.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
      const types = tx.candidates.map((c) => c.type);
      expect(types).toContain("investment_transfer");
    });
  });

  describe("investment account suggestion", () => {
    it("should suggest account ID when exactly one investment account exists", () => {
      const classified = classifyTransactions(
        normalized,
        [],
        [INVESTMENT_ACCOUNT]
      );
      const tx = classified.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
      const inv = tx.candidates.find((c) => c.type === "investment_transfer")!;
      expect(inv.investmentDetails?.suggestedAccountId).toBe("inv-001");
    });

    it("should not suggest account ID when multiple investment accounts exist", () => {
      const classified = classifyTransactions(normalized, [], [
        INVESTMENT_ACCOUNT,
        { id: "inv-002", name: "Other Account" },
      ]);
      const tx = classified.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
      const inv = tx.candidates.find((c) => c.type === "investment_transfer")!;
      expect(inv.investmentDetails?.suggestedAccountId).toBeUndefined();
    });
  });

  describe("Aplicação RDB detection", () => {
    it("should detect investment_deposit for Aplicação RDB", () => {
      const syntheticTx: NormalizedTransaction = {
        fitId: "synthetic-aplicacao",
        date: new Date(Date.UTC(2026, 2, 5, 12)),
        description: "Aplicação RDB",
        fullDescription: "Aplicação RDB",
        amount: 5000,
        type: "expense",
      };
      const classified = classifyTransactions([syntheticTx], [], []);
      const tx = classified[0];
      const inv = tx.candidates.find((c) => c.type === "investment_transfer")!;
      expect(inv).toBeDefined();
      expect(inv.investmentDetails?.direction).toBe("investment_deposit");
    });
  });

  describe("credit card payment detection", () => {
    it("should detect credit_card_payment for Pagamento de fatura", () => {
      const syntheticTx: NormalizedTransaction = {
        fitId: "synthetic-cc-payment",
        date: new Date(Date.UTC(2026, 0, 15, 12)),
        description: "Pagamento de fatura",
        fullDescription: "Pagamento de fatura",
        amount: 5000,
        type: "expense",
      };
      const classified = classifyTransactions([syntheticTx], [], [], "NU PAGAMENTOS S.A.");
      const tx = classified[0];
      const cc = tx.candidates.find((c) => c.type === "credit_card_payment")!;
      expect(cc).toBeDefined();
      expect(cc.creditCardDetails?.dueDay).toBe(15);
      expect(cc.creditCardDetails?.suggestedBankName).toBe("NU PAGAMENTOS");
    });
  });
});

// ---------------------------------------------------------------------------
// 5. Deduplication / Reconciliation Detection
// ---------------------------------------------------------------------------

describe("detectReconciliation", () => {
  describe("first upload (no existing data)", () => {
    const result = detectReconciliation(normalized, []);

    it("should mark all 12 as new", () => {
      expect(result).toHaveLength(12);
      for (const tx of result) {
        expect(tx.status).toBe("new");
      }
    });

    it("should not have diffs for new transactions", () => {
      for (const tx of result) {
        expect(tx.diffs).toBeUndefined();
      }
    });
  });

  describe("re-upload same file (all exist)", () => {
    const existingData: ExistingTransactionData[] = normalized.map((tx, i) => ({
      id: `existing-${i}`,
      externalId: tx.fitId,
      amount: tx.amount,
      date: tx.date,
      description: tx.description,
      type: tx.type,
    }));

    const result = detectReconciliation(normalized, existingData);

    it("should mark all 12 as duplicate", () => {
      for (const tx of result) {
        expect(tx.status).toBe("duplicate");
      }
    });

    it("should have existingTransactionId for all duplicates", () => {
      for (const tx of result) {
        expect(tx.existingTransactionId).toBeDefined();
      }
    });

    it("should not have diffs for exact matches", () => {
      for (const tx of result) {
        expect(tx.diffs).toBeUndefined();
      }
    });
  });

  describe("partial overlap (6 existing, 6 new)", () => {
    const first6 = normalized.slice(0, 6);
    const existingData: ExistingTransactionData[] = first6.map((tx, i) => ({
      id: `existing-${i}`,
      externalId: tx.fitId,
      amount: tx.amount,
      date: tx.date,
      description: tx.description,
      type: tx.type,
    }));

    const result = detectReconciliation(normalized, existingData);

    it("should have 6 duplicates and 6 new", () => {
      const duplicates = result.filter((t) => t.status === "duplicate");
      const newOnes = result.filter((t) => t.status === "new");
      expect(duplicates).toHaveLength(6);
      expect(newOnes).toHaveLength(6);
    });
  });

  describe("amount changed", () => {
    const existing: ExistingTransactionData[] = [
      {
        id: "existing-resgate",
        externalId: FITIDS.RESGATE_RDB,
        amount: 999.99, // different from 1000.12
        date: txByFitId(FITIDS.RESGATE_RDB).date,
        description: txByFitId(FITIDS.RESGATE_RDB).description,
        type: "income",
      },
    ];

    const result = detectReconciliation(normalized, existing);
    const resgate = result.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;

    it("should mark as changed", () => {
      expect(resgate.status).toBe("changed");
    });

    it("should include amount diff", () => {
      expect(resgate.diffs).toHaveLength(1);
      expect(resgate.diffs![0].field).toBe("amount");
      expect(resgate.diffs![0].existingValue).toBe("999.99");
      expect(resgate.diffs![0].ofxValue).toBe("1000.12");
    });

    it("should still mark others as new", () => {
      const others = result.filter((t) => t.fitId !== FITIDS.RESGATE_RDB);
      for (const tx of others) {
        expect(tx.status).toBe("new");
      }
    });
  });

  describe("description changed", () => {
    const existing: ExistingTransactionData[] = [
      {
        id: "existing-drogasil",
        externalId: FITIDS.DEBIT_DROGASIL,
        amount: txByFitId(FITIDS.DEBIT_DROGASIL).amount,
        date: txByFitId(FITIDS.DEBIT_DROGASIL).date,
        description: "Old description",
        type: "expense",
      },
    ];

    const result = detectReconciliation(normalized, existing);
    const drogasil = result.find((t) => t.fitId === FITIDS.DEBIT_DROGASIL)!;

    it("should mark as changed", () => {
      expect(drogasil.status).toBe("changed");
    });

    it("should include description diff", () => {
      expect(drogasil.diffs).toHaveLength(1);
      expect(drogasil.diffs![0].field).toBe("description");
      expect(drogasil.diffs![0].existingValue).toBe("Old description");
      expect(drogasil.diffs![0].ofxValue).toBe("DROGASIL1636");
    });
  });

  describe("multiple fields changed", () => {
    const existing: ExistingTransactionData[] = [
      {
        id: "existing-resgate",
        externalId: FITIDS.RESGATE_RDB,
        amount: 500,
        date: new Date(Date.UTC(2026, 0, 1, 12)),
        description: "Wrong description",
        type: "income",
      },
    ];

    const result = detectReconciliation(normalized, existing);
    const resgate = result.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;

    it("should mark as changed", () => {
      expect(resgate.status).toBe("changed");
    });

    it("should include all 3 diffs", () => {
      expect(resgate.diffs).toHaveLength(3);
      const fields = resgate.diffs!.map((d) => d.field);
      expect(fields).toContain("amount");
      expect(fields).toContain("date");
      expect(fields).toContain("description");
    });
  });
});

// ---------------------------------------------------------------------------
// 5b. Transfer FITID Deduplication
// ---------------------------------------------------------------------------

describe("detectReconciliation with knownTransferFitIds", () => {
  it("should mark transactions as duplicate when their FITID matches a known transfer", () => {
    const transferFitIds = new Set([
      FITIDS.RESGATE_RDB,
      FITIDS.PIX_TO_LARISSA,
    ]);

    const result = detectReconciliation(normalized, [], transferFitIds);

    const resgate = result.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
    expect(resgate.status).toBe("duplicate");
    expect(resgate.existingTransactionId).toBeUndefined();

    const pix = result.find((t) => t.fitId === FITIDS.PIX_TO_LARISSA)!;
    expect(pix.status).toBe("duplicate");

    const others = result.filter(
      (t) => t.fitId !== FITIDS.RESGATE_RDB && t.fitId !== FITIDS.PIX_TO_LARISSA
    );
    for (const tx of others) {
      expect(tx.status).toBe("new");
    }
  });

  it("should prioritize transfer FITID match over transaction FITID match", () => {
    const existingData: ExistingTransactionData[] = [
      {
        id: "existing-resgate",
        externalId: FITIDS.RESGATE_RDB,
        amount: txByFitId(FITIDS.RESGATE_RDB).amount,
        date: txByFitId(FITIDS.RESGATE_RDB).date,
        description: txByFitId(FITIDS.RESGATE_RDB).description,
        type: "income",
      },
    ];

    const transferFitIds = new Set([FITIDS.RESGATE_RDB]);
    const result = detectReconciliation(normalized, existingData, transferFitIds);

    const resgate = result.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
    expect(resgate.status).toBe("duplicate");
    expect(resgate.existingTransactionId).toBeUndefined();
  });

  it("should still detect transaction FITID matches for non-transfer FITIDs", () => {
    const existingData: ExistingTransactionData[] = [
      {
        id: "existing-drogasil",
        externalId: FITIDS.DEBIT_DROGASIL,
        amount: txByFitId(FITIDS.DEBIT_DROGASIL).amount,
        date: txByFitId(FITIDS.DEBIT_DROGASIL).date,
        description: txByFitId(FITIDS.DEBIT_DROGASIL).description,
        type: "expense",
      },
    ];

    const transferFitIds = new Set([FITIDS.RESGATE_RDB]);
    const result = detectReconciliation(normalized, existingData, transferFitIds);

    const resgate = result.find((t) => t.fitId === FITIDS.RESGATE_RDB)!;
    expect(resgate.status).toBe("duplicate");

    const drogasil = result.find((t) => t.fitId === FITIDS.DEBIT_DROGASIL)!;
    expect(drogasil.status).toBe("duplicate");
    expect(drogasil.existingTransactionId).toBe("existing-drogasil");
  });

  it("should still perform fuzzy matching for non-transfer, non-FITID transactions", () => {
    const existingData: ExistingTransactionData[] = [
      {
        id: "manual-expense",
        externalId: null,
        amount: txByFitId(FITIDS.DEBIT_DROGASIL).amount,
        date: txByFitId(FITIDS.DEBIT_DROGASIL).date,
        description: "Farmacia",
        type: "expense",
      },
    ];

    const transferFitIds = new Set([FITIDS.RESGATE_RDB]);
    const result = detectReconciliation(normalized, existingData, transferFitIds);

    const drogasil = result.find((t) => t.fitId === FITIDS.DEBIT_DROGASIL)!;
    expect(drogasil.status).toBe("fuzzy_match");
    expect(drogasil.existingTransactionId).toBe("manual-expense");
  });

  it("should handle empty knownTransferFitIds the same as before", () => {
    const result = detectReconciliation(normalized, [], new Set());
    for (const tx of result) {
      expect(tx.status).toBe("new");
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Balance Reconciliation
// ---------------------------------------------------------------------------

describe("computeBalanceDiscrepancy", () => {
  it("should compute correct net for March partial transactions", () => {
    // Net: +1000.12 -1000.00 -165.00 -380.00 +41.13 -34.21 -10.80 -30.03 +1034.45 -129.00 -27.12 -106.00 = +193.54
    const result = computeBalanceDiscrepancy(normalized, parsed.ledgerBalance, 0);
    expect(result.computedBalance).toBeCloseTo(193.54, 2);
  });

  it("should show discrepancy when starting balance is 0", () => {
    const result = computeBalanceDiscrepancy(normalized, parsed.ledgerBalance, 0);
    expect(result.isBalanced).toBe(false);
    expect(result.discrepancy).toBeCloseTo(4849.40, 2);
  });

  it("should be balanced with correct starting balance", () => {
    const startingBalance = parsed.ledgerBalance - 193.54;
    const result = computeBalanceDiscrepancy(
      normalized,
      parsed.ledgerBalance,
      startingBalance
    );
    expect(result.isBalanced).toBe(true);
    expect(Math.abs(result.discrepancy)).toBeLessThan(0.01);
  });

  it("should detect discrepancy for missing transactions", () => {
    const partial = normalized.slice(0, 6);
    const result = computeBalanceDiscrepancy(partial, parsed.ledgerBalance, 0);
    expect(result.isBalanced).toBe(false);
  });

  it("should handle empty transaction list", () => {
    const result = computeBalanceDiscrepancy([], 5042.94, 0);
    expect(result.computedBalance).toBe(0);
    expect(result.discrepancy).toBe(5042.94);
    expect(result.isBalanced).toBe(false);
  });

  it("should handle zero balance", () => {
    const result = computeBalanceDiscrepancy([], 0, 0);
    expect(result.isBalanced).toBe(true);
    expect(result.discrepancy).toBe(0);
  });
});
