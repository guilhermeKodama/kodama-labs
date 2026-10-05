import { defineDictionary } from "./define";

/**
 * Names of the views the server creates, by dataset and seed key. The pt-BR
 * names are the mockup's (canvas DEFAULT_VIEWS); "PJ" carries no month.
 */
export const views = defineDictionary(
  {
    builtin: {
      all: "Todas",
    },
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
  },
  {
    builtin: {
      all: "All",
    },
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
  }
);

type SeededViewNames = (typeof views)["pt-BR"];
/** Seed keys (SavedView.seedKey) per dataset; `views.<dataset>.<seedKey>` is each seeded view's name. */
export type LedgerViewSeedKey = keyof SeededViewNames["ledger"];
export type HoldingsViewSeedKey = keyof SeededViewNames["holdings"];
export type InvestmentOpsViewSeedKey = keyof SeededViewNames["investment_ops"];
