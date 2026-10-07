import { defineDictionary } from "./define";

/**
 * Names of the views the server creates, by dataset and seed key. The pt-BR
 * names are the mockup's (canvas DEFAULT_VIEWS); "PJ" carries no month.
 * flowKind holds the "Tipo" labels (mockup KIND_LABEL) the CSV export writes;
 * categoryFlow the Categoria of an uncategorized aporte or transfer (as the table shows it).
 */
export const views = defineDictionary(
  {
    builtin: {
      all: "Todas",
    },
    /** A view created without a name ("+ Nova view"); the next ones are numbered: "Nova view 2". */
    newView: "Nova view",
    ledger: {
      pj: "PJ",
      subs: "Assinaturas",
      ir: "Dedutíveis IR",
      cat: "Gastos por categoria",
      pivot: "Categoria × entidade",
      board: "Por conta",
      cal: "Calendário de gastos",
      trend: "Gastos por mês",
      flow: "Fluxo do mês",
      balance: "Saídas acumuladas",
      taxpj: "Impostos PJ",
    },
    holdings: {
      byClass: "Por classe",
      byBroker: "Por corretora",
      byEntity: "Por entidade",
      list: "Lista",
    },
    investment_ops: {
      income12m: "Proventos 12m",
      operations: "Operações",
    },
    flowKind: {
      in: "Entrada",
      out: "Saída",
      transfer: "Transferência",
      invest: "Aporte",
    },
    categoryFlow: {
      invest: "Investimentos",
      transfer: "Transferência",
    },
  },
  {
    builtin: {
      all: "All",
    },
    newView: "New view",
    ledger: {
      pj: "Business",
      subs: "Subscriptions",
      ir: "Tax deductible",
      cat: "Spending by category",
      pivot: "Category × entity",
      board: "By account",
      cal: "Spending calendar",
      trend: "Spending by month",
      flow: "Month flow",
      balance: "Cumulative outflows",
      taxpj: "Business taxes",
    },
    holdings: {
      byClass: "By class",
      byBroker: "By broker",
      byEntity: "By entity",
      list: "List",
    },
    investment_ops: {
      income12m: "Income 12m",
      operations: "Operations",
    },
    flowKind: {
      in: "Income",
      out: "Expense",
      transfer: "Transfer",
      invest: "Investment",
    },
    categoryFlow: {
      invest: "Investments",
      transfer: "Transfer",
    },
  }
);

type SeededViewNames = (typeof views)["pt-BR"];
/** Seed keys (SavedView.seedKey) per dataset; `views.<dataset>.<seedKey>` is each seeded view's name. */
export type LedgerViewSeedKey = keyof SeededViewNames["ledger"];
export type HoldingsViewSeedKey = keyof SeededViewNames["holdings"];
export type InvestmentOpsViewSeedKey = keyof SeededViewNames["investment_ops"];
