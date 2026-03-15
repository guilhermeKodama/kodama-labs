import type { DbClient } from "@capital/server/lib/prisma";
import { insertBill } from "../data/commands/insert-bill";
import { insertBillTransactions } from "../data/commands/insert-bill-transactions";
import { parseCsvContent, parseDate, computeCycleStart } from "./parsers";
import type { ParsedTransaction } from "./parsers";

// Re-export for backwards compatibility (tests, other consumers)
export { parseCsvContent } from "./parsers";
export type { ParsedTransaction } from "./parsers";

import { normalizeDescription } from "../utils";

interface ProcessBillCsvInput {
  creditCardId: string;
  closingDate: Date;
  dueDate: Date;
  csvContent: string;
  csvFileName: string;
  transactionId?: string; // Link to existing expense transaction
}

/**
 * IOF-related adjustments ("Ajuste a crédito", "IOF de volta") are always part of
 * the current billing cycle because they pair with IOF charges in the same bill.
 * They bypass the date-based credit cutoff that filters previous-cycle estornos.
 */
function isIofAdjustment(description: string): boolean {
  const lower = description.toLowerCase();
  return lower.includes("ajuste a crédito") || lower.includes("iof de volta");
}

/**
 * Calculate the bill total from parsed transactions and the bill's closing date.
 *
 * Positive amounts (charges) are always included. Negative amounts (credits/refunds)
 * are only included if they fall within the current billing cycle OR are IOF-related
 * adjustments (which always belong to the current cycle). Previous-cycle estornos
 * (refunds of charges billed in a prior month) are excluded.
 *
 * The cycle boundary is determined by the "Pagamento recebido" date when available
 * (the payment closes out the previous bill), falling back to an estimate based on
 * the closing date.
 */
export function calculateBillTotal(
  parsedTransactions: ParsedTransaction[],
  closingDate: Date
): number {
  const chargeTransactions = parsedTransactions.filter((t) => !t.isPayment);
  const paymentTransactions = parsedTransactions.filter((t) => t.isPayment);

  let creditCutoff: Date;
  if (paymentTransactions.length > 0) {
    try {
      const paymentDates = paymentTransactions.map((t) => parseDate(t.date));
      creditCutoff = new Date(Math.max(...paymentDates.map((d) => d.getTime())));
    } catch {
      creditCutoff = computeCycleStart(closingDate);
    }
  } else {
    creditCutoff = computeCycleStart(closingDate);
  }

  return chargeTransactions.reduce((sum, t) => {
    if (t.amount >= 0) return sum + t.amount;

    if (isIofAdjustment(t.description)) return sum + t.amount;

    try {
      const txDate = parseDate(t.date);
      return txDate >= creditCutoff ? sum + t.amount : sum;
    } catch {
      return sum + t.amount;
    }
  }, 0);
}

/**
 * Process a CSV credit card bill: parse CSV, save bill + transactions, create installments.
 * AI categorization is handled asynchronously via cron job.
 *
 * If a bill already exists for the same creditCardId + closingDate, it is atomically
 * replaced: old bill is deleted (cascading transactions + installments) and a new one
 * is created, preserving manual categorizations and linked expense transactions.
 */
export async function processBillCsv(
  userId: string,
  input: ProcessBillCsvInput,
  db: DbClient
) {
  // 1. Parse CSV
  const parsedTransactions = parseCsvContent(input.csvContent);

  if (parsedTransactions.length === 0) {
    throw new Error("No valid transactions found in CSV");
  }

  // 2. Calculate bill total and filter charge transactions
  const chargeTransactions = parsedTransactions.filter((t) => !t.isPayment);
  const totalAmount = calculateBillTotal(parsedTransactions, input.closingDate);

  // 3. Check for existing bill with same card + closing date (replace semantics)
  const existingBill = await db.creditCardBill.findFirst({
    where: {
      creditCardId: input.creditCardId,
      closingDate: input.closingDate,
      creditCard: {
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
    },
    include: {
      billTransactions: {
        select: {
          description: true,
          amount: true,
          category: true,
          isAutoCategorized: true,
        },
      },
    },
  });

  let replaced = false;
  let preservedTransactionId: string | undefined;
  let preservedStatus: string | undefined;
  const preservedCategories = new Map<string, string>();

  if (existingBill) {
    replaced = true;

    // 3a. Preserve manual categorizations (user-set, not "Uncategorized")
    for (const bt of existingBill.billTransactions) {
      if (!bt.isAutoCategorized && bt.category !== "Uncategorized") {
        const key = `${bt.description}::${bt.amount}`;
        preservedCategories.set(key, bt.category);
      }
    }

    // 3b. Preserve linked expense transaction and status
    preservedTransactionId = existingBill.transactionId ?? undefined;
    preservedStatus = existingBill.status;

    // 3c. Delete the old bill (cascade removes transactions + installments)
    await db.creditCardBill.delete({
      where: { id: existingBill.id },
    });
  }

  // 4. Determine transaction link and status
  //    Priority: explicit input > preserved from old bill
  const effectiveTransactionId = input.transactionId ?? preservedTransactionId;
  const effectiveStatus = input.transactionId
    ? "paid" as const
    : preservedTransactionId
      ? (preservedStatus as "pending" | "paid" | "overdue") ?? "pending" as const
      : undefined;

  // 5. Create bill record
  const bill = await insertBill(
    userId,
    {
      creditCardId: input.creditCardId,
      transactionId: effectiveTransactionId,
      closingDate: input.closingDate,
      dueDate: input.dueDate,
      totalAmount: Math.round(totalAmount * 100) / 100,
      csvFileName: input.csvFileName,
      status: effectiveTransactionId ? effectiveStatus ?? "paid" : undefined,
    },
    db
  );

  // 6. Load learned merchant-to-category mappings for this user
  const merchantMappings = await db.merchantCategoryMapping.findMany({
    where: { userId },
    select: { normalizedDescription: true, category: true },
  });
  const mappingLookup = new Map(
    merchantMappings.map((m) => [m.normalizedDescription, m.category])
  );

  // 7. Create bill transactions, applying: preserved manual > learned mapping > Uncategorized
  const billTransactionData = chargeTransactions.map((t) => {
    const key = `${t.description}::${t.amount}`;
    const preservedCategory = preservedCategories.get(key);
    const mappedCategory = mappingLookup.get(normalizeDescription(t.description));
    return {
      billId: bill.id,
      category: preservedCategory ?? mappedCategory ?? "Uncategorized",
      transactionDate: parseDate(t.date),
      description: t.description,
      amount: t.amount,
      installmentNumber: t.installmentNumber,
      totalInstallments: t.totalInstallments,
      isAutoCategorized: false,
    };
  });

  await insertBillTransactions(billTransactionData, db);

  // 7a. If every transaction got a category, skip the AI cron entirely
  const allPreCategorized = billTransactionData.every(
    (t) => t.category !== "Uncategorized"
  );
  if (allPreCategorized) {
    await db.creditCardBill.update({
      where: { id: bill.id },
      data: { categorizationStatus: "completed" },
    });
  }

  // 8. Create or update installment records for transactions with installment info.
  //    When the same purchase appears across multiple bills (e.g., "STORE 3/10" in Jan,
  //    "STORE 4/10" in Feb), we UPDATE the existing installment instead of creating a
  //    duplicate. Matching key: creditCardId + description + installmentAmount + totalInstallments.
  const createdBillTransactions = await db.billTransaction.findMany({
    where: { billId: bill.id },
    select: {
      id: true,
      description: true,
      amount: true,
      transactionDate: true,
      installmentNumber: true,
      totalInstallments: true,
    },
  });

  const installmentBillTxs = createdBillTransactions.filter(
    (bt) =>
      bt.installmentNumber != null &&
      bt.totalInstallments != null &&
      bt.totalInstallments > 1
  );

  let installmentCount = 0;

  for (const bt of installmentBillTxs) {
    // Look for an existing installment from a previous bill for the same purchase
    const existingInstallment = await db.installment.findFirst({
      where: {
        creditCardId: input.creditCardId,
        description: bt.description,
        installmentAmount: bt.amount,
        totalInstallments: bt.totalInstallments!,
      },
      select: { id: true },
    });

    if (existingInstallment) {
      // Update existing installment to point to the new bill's transaction
      await db.installment.update({
        where: { id: existingInstallment.id },
        data: {
          billTransactionId: bt.id,
          paidInstallments: bt.installmentNumber!,
          startDate: bt.transactionDate,
          isActive: bt.installmentNumber! < bt.totalInstallments!,
        },
      });
    } else {
      // Create new installment
      await db.installment.create({
        data: {
          creditCardId: input.creditCardId,
          billTransactionId: bt.id,
          description: bt.description,
          totalAmount: Math.round(bt.amount * bt.totalInstallments! * 100) / 100,
          totalInstallments: bt.totalInstallments!,
          paidInstallments: bt.installmentNumber!,
          startDate: bt.transactionDate,
          installmentAmount: bt.amount,
          isActive: bt.installmentNumber! < bt.totalInstallments!,
        },
      });
    }
    installmentCount++;
  }

  // 9. If replacing and there was a linked expense, update its amount
  if (replaced && effectiveTransactionId) {
    await db.transaction.update({
      where: { id: effectiveTransactionId },
      data: { amount: Math.round(totalAmount * 100) / 100 },
    });
  }

  // 10. Return result — categorization will happen via cron for remaining Uncategorized
  return {
    bill,
    totalAmount: Math.round(totalAmount * 100) / 100,
    transactionCount: chargeTransactions.length,
    installmentCount,
    replaced,
  };
}
