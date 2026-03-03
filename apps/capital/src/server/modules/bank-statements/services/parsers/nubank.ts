import type { StatementParserConfig } from "./types";

export const nubankStatementParser: StatementParserConfig = {
  name: "Nubank",

  detect(orgName: string): boolean {
    return orgName.toUpperCase().includes("NU PAGAMENTOS");
  },
};
