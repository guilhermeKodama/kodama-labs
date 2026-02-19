import type { DbClient } from "@capital/server/lib/prisma";
import { insertBill } from "../data/commands/insert-bill";
import { insertBillTransactions } from "../data/commands/insert-bill-transactions";
import { parseCsvContent, parseDate, computeCycleStart } from "./parsers";
import type { ParsedTransaction } from "./parsers";

// Re-export for backwards compatibility (tests, other consumers)
export { parseCsvContent } from "./parsers";
export type { ParsedTransaction } from "./parsers";

interface ProcessBillCsvInput {
  creditCardId: string;
  closingDate: Date;
  dueDate: Date;
  csvContent: string;
  csvFileName: string;
  transactionId?: string; // Link to existing expense transaction
}

/**
 * Calculate the bill total from parsed transactions and the bill's closing date.
 *
 * Positive amounts (charges) are always included. Negative amounts (credits/refunds)
 * are only included if they fall within the current billing cycle. Previous-cycle
 * credits (e.g., estornos of charges billed in the prior month) reduce the overall
 * balance but are NOT part of the current bill's "total da fatura".
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
    // Always include charges (positive amounts)
    if (t.amount >= 0) return sum + t.amount;

    // For credits/refunds (negative), only include if on or after the credit cutoff
    try {
      const txDate = parseDate(t.date);
      return txDate >= creditCutoff ? sum + t.amount : sum;
    } catch {
      // If date can't be parsed, include the amount to be safe
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

  // 6. Create bill transactions, applying preserved manual categories where possible
  const billTransactionData = chargeTransactions.map((t) => {
    const key = `${t.description}::${t.amount}`;
    const preservedCategory = preservedCategories.get(key);
    return {
      billId: bill.id,
      category: preservedCategory ?? "Uncategorized",
      transactionDate: parseDate(t.date),
      description: t.description,
      amount: t.amount,
      installmentNumber: t.installmentNumber,
      totalInstallments: t.totalInstallments,
      isAutoCategorized: false,
    };
  });

  await insertBillTransactions(billTransactionData, db);

  // 7. Create or update installment records for transactions with installment info.
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

  // 8. If replacing and there was a linked expense, update its amount
  if (replaced && effectiveTransactionId) {
    await db.transaction.update({
      where: { id: effectiveTransactionId },
      data: { amount: Math.round(totalAmount * 100) / 100 },
    });
  }

  // 9. Return result — categorization will happen via cron
  return {
    bill,
    totalAmount: Math.round(totalAmount * 100) / 100,
    transactionCount: chargeTransactions.length,
    installmentCount,
    replaced,
  };
}
