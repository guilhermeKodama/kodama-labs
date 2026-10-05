/**
 * Data and pure planning for the demo seed (prisma/seed-demo.ts): the
 * dataset of the new-UI mockup (capital-nova-ui-mockups.canvas.tsx) as
 * plain values, plus the investment plan derived from it. Nothing here
 * touches the database, so `--dry-run` can print the plan.
 *
 * Months are offsets from the "current" month M0, which plays the mockup's
 * September: M-1 and M-2 are its August and July (HISTORY), M-12 holds the
 * opening positions and M-11..M0 the twelve months of aportes.
 */

// ---------------------------------------------------------------------------
// Calendar
// ---------------------------------------------------------------------------

export interface YearMonth {
  year: number;
  /** 1-12 */
  month: number;
}

export function addMonths(ym: YearMonth, k: number): YearMonth {
  const index = ym.year * 12 + (ym.month - 1) + k;
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

export function monthIndex(ym: YearMonth): number {
  return ym.year * 12 + ym.month - 1;
}

/** YYYY-MM-DD for a day of the month offset `k` from `m0`, the day clamped to the month's length. */
export function isoDate(m0: YearMonth, k: number, day: number): string {
  const { year, month } = addMonths(m0, k);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(day, last)).padStart(2, "0")}`;
}

/** The mockup's "today" (22/09, PACE = 22/30): the seed books everything up to this day of M0. */
export const ANCHOR_DAY = 22;

export const round = (v: number, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
const floorTo = (v: number, digits: number) => {
  const f = 10 ** digits;
  return Math.floor(v * f + 1e-9) / f;
};

// ---------------------------------------------------------------------------
// Master data
// ---------------------------------------------------------------------------

/** The settings color picker's palette (settings-screen.tsx COLORS), in the mockup's category order. */
export const PALETTE = {
  gray: "#737373",
  purple: "#7c3aed",
  green: "#16a34a",
  yellow: "#ca8a04",
  cyan: "#0891b2",
  pink: "#db2777",
  blue: "#2563eb",
  orange: "#ea580c",
  red: "#dc2626",
} as const;

export type EntityKey = "pf" | "ltda" | "llc";

export const DEMO_ENTITIES: Record<EntityKey, { name: string; description: string; currency: string; taxRate: number; color: string }> = {
  pf: { name: "PF", description: "Finanças pessoais", currency: "BRL", taxRate: 0, color: PALETTE.gray },
  ltda: { name: "Kodama LTDA", description: "Simples Nacional, anexo III", currency: "BRL", taxRate: 0.06, color: PALETTE.blue },
  llc: { name: "Kodama LLC", description: "Recebe dos clientes internacionais", currency: "USD", taxRate: 0, color: PALETTE.purple },
};

export type AccountKey =
  | "nubank"
  | "nubankCard"
  | "xpCard"
  | "inter"
  | "interCard"
  | "mercury"
  | "mercuryCard"
  | "xp"
  | "tesouro"
  | "avenue"
  | "binance"
  | "interInvest"
  | "ibkr";

export interface DemoAccount {
  entity: EntityKey;
  name: string;
  institution: string;
  type: "checking" | "credit_card" | "brokerage";
  currency: string;
  /** The entity's main account ("Conta principal", renamed). */
  isDefault?: boolean;
  card?: { creditLimit: number; closingDay: number; dueDay: number; payFrom: AccountKey };
  /** Balance the mockup shows (ACCOUNTS 4131-4144); the seed sets the initial balance so it lands there. */
  balance?: number;
}

/** Mockup ACCOUNTS (4131-4144), in its order. */
export const DEMO_ACCOUNTS: Record<AccountKey, DemoAccount> = {
  nubank: { entity: "pf", name: "Nubank", institution: "Nubank", type: "checking", currency: "BRL", isDefault: true, balance: 12480 },
  nubankCard: { entity: "pf", name: "Nubank · cartão", institution: "Nubank", type: "credit_card", currency: "BRL", card: { creditLimit: 15000, closingDay: 5, dueDay: 12, payFrom: "nubank" } },
  xpCard: { entity: "pf", name: "XP · cartão", institution: "XP Investimentos", type: "credit_card", currency: "BRL", card: { creditLimit: 20000, closingDay: 28, dueDay: 7, payFrom: "nubank" } },
  inter: { entity: "ltda", name: "Inter PJ", institution: "Banco Inter", type: "checking", currency: "BRL", isDefault: true, balance: 48900 },
  interCard: { entity: "ltda", name: "Inter PJ · cartão", institution: "Banco Inter", type: "credit_card", currency: "BRL", card: { creditLimit: 8000, closingDay: 1, dueDay: 10, payFrom: "inter" } },
  mercury: { entity: "llc", name: "Mercury", institution: "Mercury", type: "checking", currency: "USD", isDefault: true, balance: 18240 },
  mercuryCard: { entity: "llc", name: "Mercury · cartão", institution: "Mercury", type: "credit_card", currency: "USD", card: { creditLimit: 10000, closingDay: 25, dueDay: 5, payFrom: "mercury" } },
  xp: { entity: "pf", name: "XP", institution: "XP Investimentos", type: "brokerage", currency: "BRL", balance: 38400 },
  tesouro: { entity: "pf", name: "Tesouro Direto", institution: "Tesouro Direto", type: "brokerage", currency: "BRL", balance: 0 },
  avenue: { entity: "pf", name: "Avenue", institution: "Avenue", type: "brokerage", currency: "USD", balance: 0 },
  binance: { entity: "pf", name: "Binance", institution: "Binance", type: "brokerage", currency: "BRL", balance: 0 },
  interInvest: { entity: "ltda", name: "Inter Invest", institution: "Banco Inter", type: "brokerage", currency: "BRL", balance: 0 },
  ibkr: { entity: "llc", name: "IBKR", institution: "Interactive Brokers", type: "brokerage", currency: "USD", balance: 0 },
};

export type CategoryKey =
  | "moradia"
  | "mercado"
  | "restaurantes"
  | "saude"
  | "software"
  | "impostos"
  | "delivery"
  | "receita"
  | "rendimentos"
  | "transporte"
  | "lazer"
  | "contabilidade"
  | "assinaturas"
  | "casa"
  | "eletronicos"
  | "pets"
  | "investimentos"
  | "viagens"
  | "equipamentos"
  | "ipvaIptu";

/**
 * Mockup CATEGORY_OPTS (4150), master data (5839-5847) and the yearly
 * budgets' categories. `systemKey` reuses the signup category (named in
 * pt-BR); the others are created.
 */
export const DEMO_CATEGORIES: Record<CategoryKey, { systemKey?: string; name?: string; type?: "income" | "expense" | "investment"; color: string }> = {
  moradia: { name: "Moradia", type: "expense", color: PALETTE.blue },
  mercado: { systemKey: "groceries", color: PALETTE.green },
  restaurantes: { systemKey: "restaurants_dining", color: PALETTE.orange },
  saude: { systemKey: "health_pharmacy", color: PALETTE.red },
  software: { systemKey: "software_tools", color: PALETTE.purple },
  impostos: { systemKey: "taxes", color: PALETTE.gray },
  delivery: { name: "Delivery", type: "expense", color: PALETTE.pink },
  receita: { systemKey: "client_payment", color: PALETTE.green },
  rendimentos: { systemKey: "interest", color: PALETTE.cyan },
  transporte: { systemKey: "transportation", color: PALETTE.yellow },
  lazer: { systemKey: "entertainment", color: PALETTE.cyan },
  contabilidade: { systemKey: "legal_accounting", color: PALETTE.blue },
  assinaturas: { systemKey: "subscriptions", color: PALETTE.purple },
  casa: { systemKey: "home", color: PALETTE.orange },
  eletronicos: { name: "Eletrônicos", type: "expense", color: PALETTE.yellow },
  pets: { name: "Pets", type: "expense", color: PALETTE.green },
  investimentos: { name: "Investimentos", type: "investment", color: PALETTE.gray },
  viagens: { systemKey: "travel_default", color: PALETTE.blue },
  equipamentos: { systemKey: "hardware", color: PALETTE.gray },
  ipvaIptu: { name: "IPVA + IPTU", type: "expense", color: PALETTE.red },
};

/** Mockup RULES (4154): "contains" rules, as suggestCategory matches them. */
export const DEMO_RULES: { pattern: string; category: CategoryKey }[] = [
  { pattern: "ifood", category: "restaurantes" },
  { pattern: "uber", category: "transporte" },
  { pattern: "aws", category: "software" },
  { pattern: "figma", category: "software" },
  { pattern: "pão de açúcar", category: "mercado" },
  { pattern: "smartfit", category: "saude" },
  { pattern: "netflix", category: "assinaturas" },
];

// ---------------------------------------------------------------------------
// Ledger (mockup TXS t1-t18 at 449-476, HISTORY at 481)
// ---------------------------------------------------------------------------

/** HISTORY: July (M-2) is September x 1.08, August (M-1) x 0.91, for rows that are not recurring, transfers or aportes. */
export const HISTORY_SCALE: Record<number, number> = { [-2]: 1.08, [-1]: 0.91, 0: 1 };
export const MOCK_MONTHS = [-2, -1, 0] as const;

export interface DemoEntry {
  id: string;
  day: number;
  /** Description; a function when it changes by month (invoice numbers). */
  description: string | ((k: number) => string);
  account: AccountKey;
  kind: "income" | "expense";
  /** In the account's currency. */
  amount: number;
  /** Omitted = left to the categorization rules (the mockup's rule-matched rows). */
  category?: CategoryKey;
  deductible?: boolean;
}

/** Invoice numbers: September has #0141 (Globex) and #0140 (Acme); each month back is two less. */
const invoice = (n: number, client: string) => (k: number) => `Invoice #${String(n + 2 * k).padStart(4, "0")} · ${client}`;

/** The TXS rows that are plain entries (not recurring, transfers, aportes or the notebook), booked in M-2..M0. */
export const MOCK_ENTRIES: DemoEntry[] = [
  { id: "t1", day: 22, description: "Pão de Açúcar", account: "nubankCard", kind: "expense", amount: 612.4 },
  { id: "t3", day: 21, description: "iFood", account: "nubankCard", kind: "expense", amount: 86.9 },
  { id: "t7", day: 18, description: "Uber", account: "nubankCard", kind: "expense", amount: 38.7 },
  { id: "t9", day: 15, description: invoice(141, "Globex"), account: "mercury", kind: "income", amount: 5000, category: "receita" },
  { id: "t14", day: 5, description: "Consulta médica", account: "nubank", kind: "expense", amount: 450, category: "saude", deductible: true },
  { id: "t17", day: 2, description: "Rendimento CDB", account: "xp", kind: "income", amount: 312.8, category: "rendimentos" },
  { id: "t18", day: 1, description: invoice(140, "Acme"), account: "mercury", kind: "income", amount: 4000, category: "receita" },
];

export function scaledAmount(amount: number, k: number): number {
  return round(amount * (HISTORY_SCALE[k] ?? 1), 2);
}

/** t5: Inter PJ → Nubank every month of the twelve, the aportes' origin ("Distribuição LTDA → PF"). */
export const PROFIT_DISTRIBUTION = { id: "t5", day: 20, description: "Distribuição de lucros", from: "inter" as AccountKey, to: "nubank" as AccountKey, amount: 15000 };

/** t10: bought in July (M-2) in 10x of R$ 1.099,90, so September shows 3/10. */
export const NOTEBOOK = { id: "t10", k: -2, day: 15, description: "Notebook Dell", account: "xpCard" as AccountKey, amount: 10999, installments: 10, category: "eletronicos" as CategoryKey };

export interface DemoRecurring {
  id: string;
  description: string;
  day: number;
  /** First occurrence: M-2 (the mockup's July) for the expenses, M-11 for the monthly aporte. */
  startK: number;
  account: AccountKey;
  toAccount?: AccountKey;
  kind: "expense" | "transfer";
  amount: number;
  category?: CategoryKey;
  deductible?: boolean;
}

/** TXS rows flagged recurring: rent, subscriptions, DAS and the monthly aporte (t8). */
export const DEMO_RECURRING: DemoRecurring[] = [
  { id: "t15", description: "Aluguel", day: 5, startK: -2, account: "nubank", kind: "expense", amount: 4200, category: "moradia" },
  { id: "t16", description: "Plano de saúde", day: 3, startK: -2, account: "nubank", kind: "expense", amount: 980, category: "saude", deductible: true },
  { id: "t11", description: "SmartFit", day: 12, startK: -2, account: "nubankCard", kind: "expense", amount: 149.9, category: "saude" },
  { id: "t2", description: "AWS", day: 22, startK: -2, account: "mercuryCard", kind: "expense", amount: 222.6, category: "software" },
  { id: "t12", description: "Cursor Pro", day: 10, startK: -2, account: "mercuryCard", kind: "expense", amount: 20, category: "software" },
  { id: "t6", description: "Figma", day: 19, startK: -2, account: "interCard", kind: "expense", amount: 245, category: "software" },
  { id: "t13", description: "Contabilizei", day: 8, startK: -2, account: "inter", kind: "expense", amount: 289, category: "contabilidade" },
  { id: "t4", description: "DAS Simples Nacional", day: 20, startK: -2, account: "inter", kind: "expense", amount: 3120.55, category: "impostos" },
  { id: "t8", description: "Aporte mensal", day: 16, startK: -11, account: "nubank", toAccount: "xp", kind: "transfer", amount: 8000 },
];

/**
 * What the yearly budgets (3233-3237) say was spent this year: IPVA + IPTU
 * between January and March, two of three trips, and the PJ equipment.
 * `month` is the calendar month of M0's year; the seed books a row only
 * when that month is before M-2 (so the mockup's three months stay as they
 * are) and not after the anchor.
 */
export const YEARLY_HISTORY: { month: number; day: number; description: (year: number) => string; account: AccountKey; amount: number; category: CategoryKey }[] = [
  { month: 1, day: 15, description: (y) => `IPVA ${y} · parcela 1/3`, account: "nubank", amount: 1450, category: "ipvaIptu" },
  { month: 2, day: 15, description: (y) => `IPVA ${y} · parcela 2/3`, account: "nubank", amount: 1450, category: "ipvaIptu" },
  { month: 3, day: 15, description: (y) => `IPVA ${y} · parcela 3/3`, account: "nubank", amount: 1450, category: "ipvaIptu" },
  { month: 2, day: 10, description: (y) => `IPTU ${y} · cota única`, account: "nubank", amount: 2300, category: "ipvaIptu" },
  { month: 1, day: 8, description: () => "LATAM · passagens Florianópolis", account: "nubankCard", amount: 2890, category: "viagens" },
  { month: 1, day: 9, description: () => "Airbnb · Florianópolis", account: "nubankCard", amount: 3410, category: "viagens" },
  { month: 5, day: 6, description: () => "TAP · passagens Lisboa", account: "xpCard", amount: 5240, category: "viagens" },
  { month: 5, day: 7, description: () => "Booking.com · Lisboa", account: "xpCard", amount: 2660, category: "viagens" },
  { month: 2, day: 18, description: () => 'Monitor LG UltraFine 32"', account: "interCard", amount: 4299, category: "equipamentos" },
  { month: 4, day: 9, description: () => "MacBook Air M3", account: "interCard", amount: 6700, category: "equipamentos" },
];

// ---------------------------------------------------------------------------
// Budgets (mockup BUDGETS 3207-3216, YEARLY_BUDGETS 3233-3237)
// ---------------------------------------------------------------------------

/** `null` entity = every entity: the mockup's "Software · PJ" row adds LTDA (Figma) and LLC (AWS, Cursor) spend, 1.557 in September. */
export const MONTHLY_BUDGETS: { category: CategoryKey; entity: EntityKey | null; amount: number }[] = [
  { category: "moradia", entity: "pf", amount: 4500 },
  { category: "mercado", entity: "pf", amount: 2000 },
  { category: "restaurantes", entity: "pf", amount: 800 },
  { category: "saude", entity: "pf", amount: 1800 },
  { category: "lazer", entity: "pf", amount: 1000 },
  { category: "transporte", entity: "pf", amount: 400 },
  { category: "impostos", entity: "ltda", amount: 3500 },
  { category: "software", entity: null, amount: 2500 },
  { category: "contabilidade", entity: "ltda", amount: 300 },
];

export const YEARLY_BUDGETS: { category: CategoryKey; entity: EntityKey; amount: number; notes: string }[] = [
  { category: "ipvaIptu", entity: "pf", amount: 6800, notes: "pago entre jan e mar" },
  { category: "viagens", entity: "pf", amount: 25000, notes: "2 de 3 viagens feitas" },
  { category: "equipamentos", entity: "ltda", amount: 12000, notes: "notebook parcelado em 10x" },
];

// ---------------------------------------------------------------------------
// Portfolio (mockup HOLDINGS 3670-3683, TARGET 3685, PRICES 6112, aportes 4008-4070)
// ---------------------------------------------------------------------------

export const TARGETS = [
  { allocationClass: "fixed_income", targetPercent: 40 },
  { allocationClass: "br_stocks", targetPercent: 20 },
  { allocationClass: "fii", targetPercent: 10 },
  { allocationClass: "international", targetPercent: 25 },
  { allocationClass: "crypto", targetPercent: 5 },
  { allocationClass: "cash", targetPercent: 0 },
] as const;

/**
 * "Aportes por mês e classe" (R$ mil, out..set = M-11..M0). The months add
 * up to the KPIs: 15 mil in September, 171 mil in 12 months, 14.250 a month.
 */
export const APORTES_BY_CLASS = {
  fixedIncome: [6, 5, 6, 7, 5, 6, 6, 7, 5, 6, 6, 4],
  brStocks: [3, 3, 2, 3, 4, 3, 3, 4, 4, 3, 4, 4],
  fii: [2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 2, 2],
  international: [2, 3, 3, 3, 2, 3, 3, 3, 4, 4, 3, 4],
  crypto: [0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
} as const;

/** Each month: R$ 8.000 to XP (Aporte mensal) buys Ações BR, FIIs and the LCA; the rest of Renda fixa goes to Tesouro Direto. */
const XP_MONTHLY = 8;
/** The LLC puts US$ 370 (≈ R$ 2 mil) into VOO every month; Avenue (QQQM) takes the rest of Internacional. */
const IBKR_MONTHLY_USD = 370;
const IBKR_MONTHLY_BRL_K = 2;

export type HoldingKey = "IPCA35" | "CDB" | "LCA" | "BOVA11" | "ITUB4" | "WEGE3" | "HGLG11" | "KNRI11" | "VOO" | "QQQM" | "BTC";

export interface HoldingSpec {
  key: HoldingKey;
  ticker: string;
  name: string;
  account: AccountKey;
  assetClass: "fixed_income" | "etf" | "stocks" | "fii" | "international_etf" | "crypto";
  subType?: "tesouro_ipca" | "cdb" | "lca";
  /** The holding's currency (its broker's). */
  currency: "BRL" | "USD";
  /** Mockup value in BRL and return; the cost basis is value / (1 + ret). */
  valueBrl: number;
  ret: number;
  /** Final price in BRL (mockup PRICES); for "pu" assets it is derived so the value matches. */
  finalPriceBrl?: number;
  /** Price a year before (M-12), in the holding's currency. */
  startPrice: number;
  /** market: fixed final price, opening price derived; pu: opening at startPrice, final price derived (fixed income units). */
  mode: "market" | "pu";
  qtyDecimals: number;
  priceDecimals: number;
  /** Relative price noise of the monthly buys. */
  volatility: number;
}

export const HOLDINGS: HoldingSpec[] = [
  { key: "IPCA35", ticker: "IPCA35", name: "Tesouro IPCA+ 2035", account: "tesouro", assetClass: "fixed_income", subType: "tesouro_ipca", currency: "BRL", valueBrl: 312400, ret: 0.142, finalPriceBrl: 3124, startPrice: 2780, mode: "market", qtyDecimals: 2, priceDecimals: 2, volatility: 0.004 },
  { key: "CDB", ticker: "CDB", name: "CDB Inter 110% CDI", account: "interInvest", assetClass: "fixed_income", subType: "cdb", currency: "BRL", valueBrl: 158900, ret: 0.098, startPrice: 1000, mode: "pu", qtyDecimals: 4, priceDecimals: 2, volatility: 0 },
  { key: "LCA", ticker: "LCA", name: "LCA BTG 95% CDI", account: "xp", assetClass: "fixed_income", subType: "lca", currency: "BRL", valueBrl: 68200, ret: 0.071, startPrice: 1000, mode: "pu", qtyDecimals: 4, priceDecimals: 2, volatility: 0 },
  { key: "BOVA11", ticker: "BOVA11", name: "iShares Ibovespa", account: "xp", assetClass: "etf", currency: "BRL", valueBrl: 118300, ret: 0.124, finalPriceBrl: 128.4, startPrice: 112, mode: "market", qtyDecimals: 0, priceDecimals: 2, volatility: 0.015 },
  { key: "ITUB4", ticker: "ITUB4", name: "Itaú Unibanco PN", account: "xp", assetClass: "stocks", currency: "BRL", valueBrl: 64100, ret: 0.213, finalPriceBrl: 36.9, startPrice: 30.5, mode: "market", qtyDecimals: 0, priceDecimals: 2, volatility: 0.015 },
  { key: "WEGE3", ticker: "WEGE3", name: "WEG ON", account: "xp", assetClass: "stocks", currency: "BRL", valueBrl: 48800, ret: -0.042, finalPriceBrl: 52.1, startPrice: 55.8, mode: "market", qtyDecimals: 0, priceDecimals: 2, volatility: 0.02 },
  { key: "HGLG11", ticker: "HGLG11", name: "CSHG Logística", account: "xp", assetClass: "fii", currency: "BRL", valueBrl: 82400, ret: 0.06, finalPriceBrl: 158.2, startPrice: 150, mode: "market", qtyDecimals: 0, priceDecimals: 2, volatility: 0.01 },
  { key: "KNRI11", ticker: "KNRI11", name: "Kinea Renda Imob.", account: "xp", assetClass: "fii", currency: "BRL", valueBrl: 71700, ret: 0.031, finalPriceBrl: 141.6, startPrice: 138, mode: "market", qtyDecimals: 0, priceDecimals: 2, volatility: 0.01 },
  { key: "VOO", ticker: "VOO", name: "Vanguard S&P 500", account: "ibkr", assetClass: "international_etf", currency: "USD", valueBrl: 198500, ret: 0.316, finalPriceBrl: 2731.5, startPrice: 395, mode: "market", qtyDecimals: 4, priceDecimals: 2, volatility: 0.012 },
  { key: "QQQM", ticker: "QQQM", name: "Invesco Nasdaq 100", account: "avenue", assetClass: "international_etf", currency: "USD", valueBrl: 58400, ret: 0.24, finalPriceBrl: 1162.8, startPrice: 172, mode: "market", qtyDecimals: 4, priceDecimals: 2, volatility: 0.015 },
  { key: "BTC", ticker: "BTC", name: "Bitcoin", account: "binance", assetClass: "crypto", currency: "BRL", valueBrl: 64200, ret: 0.48, finalPriceBrl: 342100, startPrice: 230000, mode: "market", qtyDecimals: 8, priceDecimals: 2, volatility: 0.05 },
];

/** Ações BR and FIIs rotate over the tickers month by month. */
const BR_STOCK_ROTATION: HoldingKey[] = ["BOVA11", "ITUB4", "WEGE3"];
const FII_ROTATION: HoldingKey[] = ["HGLG11", "KNRI11"];

export const OPENING = { k: -12, day: 5 };
export const DEPOSIT_DAY = 16;
export const BUY_DAY = 17;

export interface PlannedBuy {
  holding: HoldingKey;
  k: number;
  day: number;
  quantity: number;
  price: number;
  /** quantity x price, in the holding's currency. */
  amount: number;
  opening: boolean;
}

export interface PlannedDeposit {
  /** Matches the investment_deposit transfer's broker. */
  broker: AccountKey;
  from: AccountKey;
  k: number;
  day: number;
  /** In the source account's currency. */
  amount: number;
  /** In the broker's currency, when it differs. */
  toAmount?: number;
}

export interface PlannedIncome {
  holding: HoldingKey;
  k: number;
  day: number;
  incomeType: "dividend" | "jcp" | "fii_income" | "interest";
  /** Gross, in the holding's currency. */
  gross: number;
  taxWithheld: number;
}

export interface HoldingPlan {
  spec: HoldingSpec;
  buys: PlannedBuy[];
  finalPrice: number;
  quantity: number;
  /** In the holding's currency. */
  value: number;
  cost: number;
}

export interface InvestmentPlan {
  holdings: HoldingPlan[];
  deposits: PlannedDeposit[];
  income: PlannedIncome[];
}

/** Proventos over the twelve months, per unit held on the day (FIIs monthly, JCP quarterly with 15% IR, US ETFs quarterly with 30%). */
const INCOME_RULES: { holding: HoldingKey; months: readonly number[] | "all"; day: number; incomeType: PlannedIncome["incomeType"]; perUnit: number; tax: number }[] = [
  { holding: "HGLG11", months: "all", day: 14, incomeType: "fii_income", perUnit: 1.1, tax: 0 },
  { holding: "KNRI11", months: "all", day: 15, incomeType: "fii_income", perUnit: 1.0, tax: 0 },
  { holding: "ITUB4", months: "all", day: 2, incomeType: "dividend", perUnit: 0.0182, tax: 0 },
  { holding: "ITUB4", months: [-10, -7, -4, -1], day: 21, incomeType: "jcp", perUnit: 0.4, tax: 0.15 },
  { holding: "WEGE3", months: [-11, -8, -5, -2], day: 18, incomeType: "jcp", perUnit: 0.24, tax: 0.15 },
  { holding: "VOO", months: [-9, -6, -3, 0], day: 3, incomeType: "dividend", perUnit: 1.74, tax: 0.3 },
  { holding: "QQQM", months: [-9, -6, -3, 0], day: 3, incomeType: "dividend", perUnit: 0.33, tax: 0.3 },
];

/** Monthly buy amounts per holding (in the holding's currency) and the deposits that pay for them. */
function monthlyFlows(usdRate: number) {
  const amounts = new Map<HoldingKey, number[]>(HOLDINGS.map((h) => [h.key, Array(12).fill(0)]));
  const deposits: PlannedDeposit[] = [];
  const toUsd = (brl: number) => round(brl / usdRate, 2);
  for (let i = 0; i < 12; i++) {
    const k = i - 11;
    const { fixedIncome, brStocks, fii, international, crypto } = APORTES_BY_CLASS;
    const lca = XP_MONTHLY - brStocks[i] - fii[i];
    const tesouro = fixedIncome[i] - lca;
    const avenue = international[i] - IBKR_MONTHLY_BRL_K;
    if (lca < 0 || tesouro < 0 || avenue < 0) throw new Error(`Aporte split does not fit month ${k}`);
    amounts.get(BR_STOCK_ROTATION[i % BR_STOCK_ROTATION.length])![i] += brStocks[i] * 1000;
    amounts.get(FII_ROTATION[i % FII_ROTATION.length])![i] += fii[i] * 1000;
    amounts.get("LCA")![i] += lca * 1000;
    amounts.get("IPCA35")![i] += tesouro * 1000;
    amounts.get("VOO")![i] += IBKR_MONTHLY_USD;
    deposits.push({ broker: "ibkr", from: "mercury", k, day: DEPOSIT_DAY, amount: IBKR_MONTHLY_USD });
    if (tesouro > 0) deposits.push({ broker: "tesouro", from: "nubank", k, day: DEPOSIT_DAY, amount: tesouro * 1000 });
    if (avenue > 0) {
      const usd = toUsd(avenue * 1000);
      amounts.get("QQQM")![i] += usd;
      deposits.push({ broker: "avenue", from: "nubank", k, day: DEPOSIT_DAY, amount: avenue * 1000, toAmount: usd });
    }
    if (crypto[i] > 0) {
      amounts.get("BTC")![i] += crypto[i] * 1000;
      deposits.push({ broker: "binance", from: "nubank", k, day: DEPOSIT_DAY, amount: crypto[i] * 1000 });
    }
  }
  return { amounts, deposits };
}

/** Deterministic noise per holding, so reruns build the same history. */
function pricePath(spec: HoldingSpec, finalPrice: number, i: number): number {
  const base = spec.startPrice + (finalPrice - spec.startPrice) * ((i + 1) / 12.5);
  const phase = HOLDINGS.indexOf(spec) * 0.9;
  return round(base * (1 + spec.volatility * Math.sin(i * 1.3 + phase)), spec.priceDecimals);
}

function monthlyBuys(spec: HoldingSpec, amounts: number[], finalPrice: number): PlannedBuy[] {
  const buys: PlannedBuy[] = [];
  amounts.forEach((amount, i) => {
    if (amount <= 0) return;
    const price = pricePath(spec, finalPrice, i);
    const quantity = floorTo(amount / price, spec.qtyDecimals);
    if (quantity <= 0) return;
    buys.push({ holding: spec.key, k: i - 11, day: BUY_DAY, quantity, price, amount: round(quantity * price, 2), opening: false });
  });
  return buys;
}

/**
 * Opening position (M-12) plus the monthly buys, chosen so the holding ends
 * at the mockup's value and return: market assets end at the mockup price
 * and the opening price absorbs the rest; fixed income units ("pu") open at
 * their start price and the final unit price comes out of the value.
 */
function planHolding(spec: HoldingSpec, amounts: number[], usdRate: number): HoldingPlan {
  const toCcy = (brl: number) => (spec.currency === "USD" ? brl / usdRate : brl);
  const value = toCcy(spec.valueBrl);
  const cost = toCcy(spec.valueBrl / (1 + spec.ret));
  let buys: PlannedBuy[];
  let finalPrice: number;
  let opening: PlannedBuy;
  if (spec.mode === "market") {
    finalPrice = round(toCcy(spec.finalPriceBrl!), spec.priceDecimals);
    buys = monthlyBuys(spec, amounts, finalPrice);
    const quantity = round(value / finalPrice, spec.qtyDecimals);
    const q0 = round(quantity - buys.reduce((s, b) => s + b.quantity, 0), spec.qtyDecimals);
    const c0 = cost - buys.reduce((s, b) => s + b.amount, 0);
    if (!(q0 > 0 && c0 > 0)) throw new Error(`${spec.key}: monthly buys exceed the target position`);
    const p0 = round(c0 / q0, spec.priceDecimals);
    opening = { holding: spec.key, k: OPENING.k, day: OPENING.day, quantity: q0, price: p0, amount: round(q0 * p0, 2), opening: true };
  } else {
    finalPrice = spec.startPrice * (1 + spec.ret);
    buys = [];
    let q0 = 0;
    for (let n = 0; n < 30; n++) {
      buys = monthlyBuys(spec, amounts, finalPrice);
      q0 = round((cost - buys.reduce((s, b) => s + b.amount, 0)) / spec.startPrice, spec.qtyDecimals);
      const quantity = q0 + buys.reduce((s, b) => s + b.quantity, 0);
      finalPrice = round(value / quantity, spec.priceDecimals);
    }
    if (!(q0 > 0)) throw new Error(`${spec.key}: monthly buys exceed the target cost`);
    opening = { holding: spec.key, k: OPENING.k, day: OPENING.day, quantity: q0, price: spec.startPrice, amount: round(q0 * spec.startPrice, 2), opening: true };
  }
  const all = [opening, ...buys];
  const quantity = round(all.reduce((s, b) => s + b.quantity, 0), spec.qtyDecimals);
  return {
    spec,
    buys: all,
    finalPrice,
    quantity,
    value: round(quantity * finalPrice, 2),
    cost: round(all.reduce((s, b) => s + b.amount, 0), 2),
  };
}

/** Units held at the start of `day` in month `k` (buys on that day come after). */
export function quantityOn(plan: HoldingPlan, k: number, day: number): number {
  return plan.buys.filter((b) => b.k < k || (b.k === k && b.day < day)).reduce((s, b) => s + b.quantity, 0);
}

/** The whole investment history: holdings, deposits into brokers and proventos. `usdRate` = BRL per USD. */
export function planInvestments(usdRate: number): InvestmentPlan {
  const { amounts, deposits } = monthlyFlows(usdRate);
  const holdings = HOLDINGS.map((spec) => planHolding(spec, amounts.get(spec.key)!, usdRate));
  const income: PlannedIncome[] = [];
  for (const rule of INCOME_RULES) {
    const plan = holdings.find((h) => h.spec.key === rule.holding)!;
    const months = rule.months === "all" ? Array.from({ length: 12 }, (_, i) => i - 11) : rule.months;
    for (const k of months) {
      const units = quantityOn(plan, k, rule.day);
      const gross = round(units * rule.perUnit, 2);
      if (gross <= 0) continue;
      income.push({ holding: rule.holding, k, day: rule.day, incomeType: rule.incomeType, gross, taxWithheld: round(gross * rule.tax, 2) });
    }
  }
  return { holdings, deposits, income };
}

/** Mockup FIRE card (4086-4100): R$ 12.250/mês at SWR 3,5% (R$ 4,2 mi), R$ 15.000/mês of aportes. */
export const FIRE_GOAL = {
  name: "Liberdade financeira",
  targetMonthlyIncome: 12250,
  safeWithdrawalRate: 0.035,
  nominalAnnualReturn: 0.1,
  annualInflation: 0.045,
  planningMode: "by_contribution" as const,
  phaseProfile: "constant" as const,
  phases: [{ fromMonth: 0, toMonth: null, monthlyContribution: 15000, label: "Aporte mensal" }],
  includeBusinessInvestments: true,
  currency: "BRL",
  currentAge: 34,
};
