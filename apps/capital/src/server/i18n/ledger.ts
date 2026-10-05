import { defineDictionary } from "./define";

/** Ledger strings the server writes: default transfer descriptions and CSV export headers. */
export const ledger = defineDictionary(
  {
    /** Description of a transfer created without one. */
    transferDescription: "{direction}: {from} → {to}",
    direction: {
      profit_distribution: "Distribuição de lucros",
      capital_injection: "Aporte de capital",
      reimbursement: "Reembolso",
      investment_deposit: "Aporte em investimento",
      investment_withdrawal: "Resgate de investimento",
      card_payment: "Pagamento de fatura",
      between_accounts: "Transferência entre contas",
    },
    /** CSV export column headers (the export still writes the raw field names). */
    csv: {
      date: "Data",
      description: "Descrição",
      entity: "Entidade",
      account: "Conta",
      category: "Categoria",
      kind: "Tipo",
      amount: "Valor",
      currency: "Moeda",
      amountBase: "Valor na moeda base",
      notes: "Observações",
    },
  },
  {
    transferDescription: "{direction}: {from} → {to}",
    direction: {
      profit_distribution: "Profit distribution",
      capital_injection: "Capital injection",
      reimbursement: "Reimbursement",
      investment_deposit: "Investment deposit",
      investment_withdrawal: "Investment withdrawal",
      card_payment: "Card bill payment",
      between_accounts: "Transfer between accounts",
    },
    csv: {
      date: "Date",
      description: "Description",
      entity: "Entity",
      account: "Account",
      category: "Category",
      kind: "Type",
      amount: "Amount",
      currency: "Currency",
      amountBase: "Amount in base currency",
      notes: "Notes",
    },
  }
);
