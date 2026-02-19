import type { BankParserConfig, InstallmentInfo } from "./types";

/**
 * Nubank credit card bill CSV parser config.
 *
 * Format: comma-separated, headers "date,title,amount"
 * Dates: YYYY-MM-DD
 * Amounts: 1234.56 (standard decimal, no currency symbol)
 * Installments: embedded in description as "STORE - Parcela X/Y"
 * Payments: "Pagamento recebido"
 */
export const nubankParser: BankParserConfig = {
  name: "Nubank",

  detect(headers: string[]): boolean {
    // Nubank CSVs use "date" + "title" + "amount" as headers
    const hasDate = headers.includes("date");
    const hasTitle = headers.includes("title");
    const hasAmount = headers.includes("amount");
    return hasDate && hasTitle && hasAmount;
  },

  dateHeaders: ["date"],
  descriptionHeaders: ["title"],
  amountHeaders: ["amount"],

  // Nubank embeds installments in the description, no separate column
  installmentColumn: undefined,

  parseInstallmentFromDescription(description: string): InstallmentInfo {
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
  },

  paymentKeywords: [
    "pagamento recebido",
    "pagamento efetuado",
    "payment received",
  ],
};
