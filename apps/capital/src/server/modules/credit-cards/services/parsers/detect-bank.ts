import type { BankParserConfig } from "./types";
import { nubankParser } from "./nubank";
import { xpParser } from "./xp";

/**
 * Registry of all supported bank parsers.
 * To add a new bank, import its config and append it here.
 *
 * Order matters: more specific parsers should come first.
 * The generic fallback is returned when no parser matches.
 */
const bankParsers: BankParserConfig[] = [
  xpParser,     // XP before generic — it has distinct headers
  nubankParser,
];

/**
 * Auto-detect which bank a CSV belongs to based on its headers.
 * Returns the matching BankParserConfig, or undefined if no parser matches.
 */
export function detectBankParser(headers: string[]): BankParserConfig | undefined {
  const normalized = headers.map((h) => h.toLowerCase().trim());
  return bankParsers.find((parser) => parser.detect(normalized));
}

/**
 * Build a generic fallback parser config from headers.
 * Uses broad header-name matching (same logic as the original parseCsvContent).
 */
export function buildFallbackParser(headers: string[]): BankParserConfig {
  return {
    name: "Generic",

    detect: () => true,

    dateHeaders: ["date", "data", "transaction_date", "data da compra"],
    descriptionHeaders: [
      "description", "descricao", "descrição",
      "title", "titulo", "título",
      "estabelecimento",
    ],
    amountHeaders: ["amount", "valor", "value", "quantia"],

    installmentColumn: undefined,

    parseInstallmentFromDescription(description: string) {
      // Match "- Parcela X/Y" at the end
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

      // Match "(X/Y)" or "X/Y" at the end
      const genericMatch = description.match(
        /\s*\(?(\d{1,2})\/(\d{1,2})\)?\s*$/
      );
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
      "pagamentos validos normais",
      "pagamentos validados",
    ],
  };
}
