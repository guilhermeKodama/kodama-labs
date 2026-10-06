const SYMBOL: Record<string, string> = { BRL: "R$", USD: "US$", EUR: "€", GBP: "£", JPY: "¥" };

export function money(value: number, currency = "BRL", digits = 2): string {
  const formatted = Math.abs(value).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
  const sign = value < 0 ? "−" : "";
  return `${sign}${SYMBOL[currency] ?? currency} ${formatted}`;
}

export function money0(value: number, currency = "BRL"): string {
  return money(Math.round(value), currency, 0);
}

export function pct(value: number, digits = 1): string {
  return `${(value * 100).toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}

export function parseAmount(input: string): number {
  const clean = input.trim().replace(/\s/g, "").replace(/^R\$/, "");
  if (!clean) return Number.NaN;
  // "1.234,56" (pt-BR) or "1234.56"
  const normalized = clean.includes(",") ? clean.replace(/\./g, "").replace(",", ".") : clean;
  return Number(normalized);
}

const MONTHS = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function monthName(month: number): string {
  return MONTHS[month - 1] ?? String(month);
}

/** "2026-10" or "2026-10-05" → "out/2026". */
export function monthLabel(iso: string): string {
  const [y, m] = iso.split("-").map(Number);
  return `${monthName(m)}/${y}`;
}

/** "2026-10-05" → "05/10". */
export function dayLabel(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

export function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function shiftMonth(key: string, delta: number): string {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthRange(key: string): { from: string; to: string } {
  const [y, m] = key.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(last).padStart(2, "0")}` };
}

export const ASSET_CLASS_LABEL: Record<string, string> = {
  fixed_income: "Renda fixa",
  stocks: "Ações BR",
  fii: "FIIs",
  etf: "ETFs",
  bdr: "BDRs",
  international_stocks: "Internacional",
  international_etf: "ETFs internacionais",
  crypto: "Cripto",
  savings: "Poupança",
};

export const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  checking: "Conta corrente",
  credit_card: "Cartão de crédito",
  brokerage: "Corretora",
  cash: "Dinheiro",
};
