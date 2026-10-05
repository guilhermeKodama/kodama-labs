export const ASSET_CLASSES = ["fixed_income", "stocks", "fii", "etf", "bdr", "international_stocks", "international_etf", "crypto", "savings"] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];

export interface Holding {
  id: string;
  accountId: string;
  accountName: string;
  entityId: string;
  assetClass: AssetClass;
  subType: string | null;
  ticker: string | null;
  name: string;
  currency: string;
  currentQuantity: number;
  averageCost: number;
  totalInvested: number;
  currentPrice: number | null;
  lastPriceUpdate: string | null;
  marketValue: number;
  unrealizedGain: number;
  unrealizedGainPercent: number | null;
  isActive: boolean;
}

export interface Allocation {
  assetClass: AssetClass;
  marketValue: number;
  invested: number;
  count: number;
  share: number;
  target: number | null;
}

export interface PortfolioSummary {
  baseCurrency: string;
  marketValue: number;
  invested: number;
  unrealizedGain: number;
  cash: number;
  netWorth: number;
  income12m: number;
  holdingsCount: number;
  accountsCount: number;
  allocation: Allocation[];
  brokers: { accountId: string; name: string; currency: string; cash: number; cashBase: number }[];
}

export interface Operation {
  id: string;
  holdingId: string;
  ticker: string | null;
  name: string | null;
  assetClass: AssetClass | null;
  type: "buy" | "sell" | "dividend" | "yield_payment" | "split" | "deposit" | "withdrawal" | "adjustment";
  quantity: number | null;
  pricePerUnit: number | null;
  totalAmount: number;
  fees: number;
  date: string;
  notes: string | null;
}

export const OP_LABEL: Record<Operation["type"], string> = {
  buy: "Compra",
  sell: "Venda",
  dividend: "Dividendo",
  yield_payment: "Rendimento",
  split: "Desdobramento",
  deposit: "Depósito",
  withdrawal: "Retirada",
  adjustment: "Ajuste",
};
