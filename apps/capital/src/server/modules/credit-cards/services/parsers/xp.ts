import type { BankParserConfig, InstallmentInfo } from "./types";

/**
 * XP Investimentos credit card bill CSV parser config.
 *
 * Format: semicolon-separated, headers "Data;Estabelecimento;Portador;Valor;Parcela"
 * Dates: DD/MM/YYYY
 * Amounts: R$ 49,92 (Brazilian format with currency symbol)
 * Installments: separate "Parcela" column with "X de Y" format, or "-" for non-installment
 * Payments: "Pagamentos Validos Normais"
 */
export const xpParser: BankParserConfig = {
  name: "XP",

  detect(headers: string[]): boolean {
    // XP CSVs use "data" + "estabelecimento" + "valor" + "parcela" as headers
    const hasData = headers.includes("data");
    const hasEstabelecimento = headers.includes("estabelecimento");
    const hasValor = headers.includes("valor");
    const hasParcela = headers.includes("parcela");
    return hasData && hasEstabelecimento && hasValor && hasParcela;
  },

  dateHeaders: ["data"],
  descriptionHeaders: ["estabelecimento"],
  amountHeaders: ["valor"],

  // XP has a dedicated installment column
  installmentColumn: "parcela",

  parseInstallmentFromColumn(value: string): {
    installmentNumber?: number;
    totalInstallments?: number;
  } {
    const trimmed = value.trim();

    // "-" or empty means no installment
    if (!trimmed || trimmed === "-") {
      return {};
    }

    // Match "X de Y" format (e.g. "11 de 12")
    const match = trimmed.match(/^(\d{1,2})\s+de\s+(\d{1,2})$/i);
    if (match) {
      const num = parseInt(match[1], 10);
      const total = parseInt(match[2], 10);
      if (num > 0 && total > 1 && num <= total) {
        return { installmentNumber: num, totalInstallments: total };
      }
    }

    // Match "X/Y" format (fallback)
    const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})$/);
    if (slashMatch) {
      const num = parseInt(slashMatch[1], 10);
      const total = parseInt(slashMatch[2], 10);
      if (num > 0 && total > 1 && num <= total) {
        return { installmentNumber: num, totalInstallments: total };
      }
    }

    return {};
  },

  parseInstallmentFromDescription(description: string): InstallmentInfo {
    // XP doesn't embed installments in descriptions, but provide a no-op
    // fallback in case the column is missing for some rows
    return { cleanDescription: description };
  },

  paymentKeywords: [
    "pagamentos validos normais",
    "pagamentos validados",
    "pagamento recebido",
    "pagamento efetuado",
  ],
};
