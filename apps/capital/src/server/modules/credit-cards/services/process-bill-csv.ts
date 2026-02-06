import type { DbClient } from "@capital/server/lib/prisma";
import { categorizeBillTransactions } from "@capital/server/lib/claude";
import { insertBill } from "../data/commands/insert-bill";
import { insertBillTransactions } from "../data/commands/insert-bill-transactions";

interface ParsedTransaction {
  date: string;
  description: string;
  amount: number;
  installmentNumber?: number;
  totalInstallments?: number;
  isPayment: boolean; // True for "Pagamento recebido" lines
}

interface ProcessBillCsvInput {
  creditCardId: string;
  closingDate: Date;
  dueDate: Date;
  csvContent: string;
  csvFileName: string;
  transactionId?: string; // Link to existing expense transaction
  categories: string[];   // Available categories for AI categorization
}

/**
 * Keywords that indicate a payment to the card (not a charge).
 * These are excluded from the bill total.
 */
const PAYMENT_KEYWORDS = [
  "pagamento recebido",
  "pagamento efetuado",
  "payment received",
];

/**
 * Check if a description refers to a payment to the card.
 */
function isPaymentLine(description: string): boolean {
  const lower = description.toLowerCase();
  return PAYMENT_KEYWORDS.some((kw) => lower.includes(kw));
}

/**
 * Parse a CSV line respecting quoted fields.
 * Handles fields like: "Estorno de ""Mercadolivre*Mercadol"""
 */
function parseCsvLine(line: string, separator: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;
  let i = 0;

  while (i < line.length) {
    const char = line[i];

    if (inQuotes) {
      if (char === '"') {
        // Check for escaped quote ""
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      current += char;
      i++;
    } else {
      if (char === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (char === separator) {
        fields.push(current.trim());
        current = "";
        i++;
        continue;
      }
      current += char;
      i++;
    }
  }

  fields.push(current.trim());
  return fields;
}

/**
 * Parse CSV content from credit card bill.
 * Supports common Brazilian bank formats (Nubank, Itaú, Bradesco, etc.).
 */
export function parseCsvContent(csvContent: string): ParsedTransaction[] {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) {
    throw new Error("CSV must have at least a header and one data row");
  }

  const header = lines[0].toLowerCase();
  const transactions: ParsedTransaction[] = [];

  // Detect separator
  const separator = header.includes(";") ? ";" : ",";
  const headers = parseCsvLine(header, separator);

  // Find column indices
  const dateIdx = headers.findIndex((h) =>
    ["date", "data", "transaction_date", "data da compra"].includes(h)
  );
  const descIdx = headers.findIndex((h) =>
    ["description", "descricao", "descrição", "title", "titulo", "título", "estabelecimento"].includes(h)
  );
  const amountIdx = headers.findIndex((h) =>
    ["amount", "valor", "value", "quantia"].includes(h)
  );

  // Determine column mapping
  const useFallback = dateIdx === -1 || descIdx === -1 || amountIdx === -1;
  const dIdx = useFallback ? 0 : dateIdx;
  const tIdx = useFallback ? 1 : descIdx;
  const aIdx = useFallback ? 2 : amountIdx;
  const minCols = Math.max(dIdx, tIdx, aIdx) + 1;

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = parseCsvLine(line, separator);
    if (cols.length < minCols) continue;

    const rawDescription = cols[tIdx];
    const amount = parseAmount(cols[aIdx]);
    if (isNaN(amount)) continue;

    const payment = isPaymentLine(rawDescription);
    const { installmentNumber, totalInstallments, cleanDescription } =
      parseInstallmentInfo(rawDescription);

    transactions.push({
      date: cols[dIdx],
      description: cleanDescription,
      amount, // Keep original sign: positive = charge, negative = refund/credit
      installmentNumber,
      totalInstallments,
      isPayment: payment,
    });
  }

  return transactions;
}

/**
 * Parse Brazilian number format (1.234,56) or standard (1234.56).
 * Preserves the sign (negative for refunds/credits).
 */
function parseAmount(value: string): number {
  let cleaned = value.trim().replace(/"/g, "");
  // Remove currency symbols
  cleaned = cleaned.replace(/R\$\s?/g, "").replace(/\$/g, "").trim();

  // Brazilian format: 1.234,56 or -1.234,56
  if (cleaned.includes(",") && cleaned.indexOf(",") > cleaned.lastIndexOf(".")) {
    cleaned = cleaned.replace(/\./g, "").replace(",", ".");
  }
  // Format like 1,234.56 (standard US)
  else if (cleaned.includes(",") && cleaned.indexOf(".") > cleaned.lastIndexOf(",")) {
    cleaned = cleaned.replace(/,/g, "");
  }
  // Only comma: 1234,56
  else if (cleaned.includes(",") && !cleaned.includes(".")) {
    cleaned = cleaned.replace(",", ".");
  }

  return parseFloat(cleaned);
}

/**
 * Extract installment info from description.
 * Supports formats:
 *   - "STORE - Parcela 1/10"  (Nubank)
 *   - "STORE (3/12)"
 *   - "STORE 3/12"
 */
function parseInstallmentInfo(description: string): {
  installmentNumber?: number;
  totalInstallments?: number;
  cleanDescription: string;
} {
  // Match "- Parcela X/Y" at the end (Nubank format)
  const parcelaMatch = description.match(
    /\s*-\s*Parcela\s+(\d{1,2})\/(\d{1,2})\s*$/i
  );
  if (parcelaMatch) {
    const num = parseInt(parcelaMatch[1], 10);
    const total = parseInt(parcelaMatch[2], 10);
    if (num > 0 && total > 1 && num <= total) {
      return {
        installmentNumber: num,
        totalInstallments: total,
        cleanDescription: description
          .replace(/\s*-\s*Parcela\s+\d{1,2}\/\d{1,2}\s*$/i, "")
          .trim(),
      };
    }
  }

  // Match "(X/Y)" or "X/Y" at the end (generic format)
  const genericMatch = description.match(/\s*\(?(\d{1,2})\/(\d{1,2})\)?\s*$/);
  if (genericMatch) {
    const num = parseInt(genericMatch[1], 10);
    const total = parseInt(genericMatch[2], 10);
    if (num > 0 && total > 1 && num <= total) {
      return {
        installmentNumber: num,
        totalInstallments: total,
        cleanDescription: description
          .replace(/\s*\(?(\d{1,2})\/(\d{1,2})\)?\s*$/, "")
          .trim(),
      };
    }
  }

  return { cleanDescription: description };
}

/**
 * Parse date string from various formats
 */
function parseDate(dateStr: string): Date {
  const cleaned = dateStr.trim().replace(/"/g, "");

  // Try YYYY-MM-DD (ISO format) — most common in Nubank CSVs
  const isoMatch = cleaned.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return new Date(
      parseInt(isoMatch[1]),
      parseInt(isoMatch[2]) - 1,
      parseInt(isoMatch[3])
    );
  }

  // Try DD/MM/YYYY (Brazilian format)
  const brMatch = cleaned.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    return new Date(
      parseInt(brMatch[3]),
      parseInt(brMatch[2]) - 1,
      parseInt(brMatch[1])
    );
  }

  // Fallback to Date constructor
  const date = new Date(cleaned);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date format: ${dateStr}`);
  }
  return date;
}

/**
 * Process a CSV credit card bill: parse, categorize with AI, and save to DB.
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

  // 2. Separate charges from payments
  //    - Charges/refunds: everything except "Pagamento recebido"
  //    - Bill total = sum of charges (with signs, so refunds reduce the total)
  const chargeTransactions = parsedTransactions.filter((t) => !t.isPayment);
  const totalAmount = chargeTransactions.reduce((sum, t) => sum + t.amount, 0);

  // 3. Auto-categorize only charge transactions (not payments)
  const categorizationInput = chargeTransactions.map((t, i) => ({
    index: i,
    description: t.description,
    amount: t.amount,
  }));

  const categorizations = await categorizeBillTransactions(
    categorizationInput,
    input.categories
  );

  // 4. Create a map of index -> category
  const categoryMap = new Map<number, string>();
  for (const c of categorizations) {
    categoryMap.set(c.index, c.category);
  }

  // 5. Create bill record
  const bill = await insertBill(
    userId,
    {
      creditCardId: input.creditCardId,
      transactionId: input.transactionId,
      closingDate: input.closingDate,
      dueDate: input.dueDate,
      totalAmount: Math.round(totalAmount * 100) / 100, // Round to 2 decimals
      csvFileName: input.csvFileName,
    },
    db
  );

  // 6. Create bill transactions (only charges, not payments)
  const billTransactionData = chargeTransactions.map((t, i) => ({
    billId: bill.id,
    category: categoryMap.get(i) || "Other",
    transactionDate: parseDate(t.date),
    description: t.description,
    amount: t.amount,
    installmentNumber: t.installmentNumber,
    totalInstallments: t.totalInstallments,
    isAutoCategorized: true,
  }));

  await insertBillTransactions(billTransactionData, db);

  // 7. Auto-create installment records for transactions with installment info
  //    First, fetch the created bill transactions to get their IDs
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

  const installmentRecords = createdBillTransactions
    .filter(
      (bt) =>
        bt.installmentNumber != null &&
        bt.totalInstallments != null &&
        bt.totalInstallments > 1
    )
    .map((bt) => ({
      creditCardId: input.creditCardId,
      billTransactionId: bt.id,
      description: bt.description,
      totalAmount: Math.round(bt.amount * bt.totalInstallments! * 100) / 100,
      totalInstallments: bt.totalInstallments!,
      paidInstallments: bt.installmentNumber!,
      startDate: bt.transactionDate,
      installmentAmount: bt.amount,
      isActive: bt.installmentNumber! < bt.totalInstallments!,
    }));

  if (installmentRecords.length > 0) {
    await db.installment.createMany({
      data: installmentRecords,
      skipDuplicates: true, // Avoid errors if re-uploading
    });
  }

  // 8. Return the created bill with transactions
  return {
    bill,
    totalAmount: Math.round(totalAmount * 100) / 100,
    transactionCount: chargeTransactions.length,
    installmentCount: installmentRecords.length,
    categorizations: categorizations.map((c) => ({
      index: c.index,
      description: chargeTransactions[c.index].description,
      amount: chargeTransactions[c.index].amount,
      category: c.category,
    })),
  };
}
