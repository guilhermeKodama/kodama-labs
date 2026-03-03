import type { StatementParserConfig } from "./types";
import { nubankStatementParser } from "./nubank";

/**
 * Registry of bank-specific OFX parsers.
 * To add a new bank, create a config file and add it here.
 */
const bankParsers: StatementParserConfig[] = [
  nubankStatementParser,
];

export function detectStatementBank(orgName: string): StatementParserConfig | undefined {
  return bankParsers.find((p) => p.detect(orgName));
}
