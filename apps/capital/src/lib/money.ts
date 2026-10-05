export function money(value: number, currency = "BRL"): string {
  const formatted = Math.abs(value).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const sign = value < 0 ? "−" : "";
  const prefix = currency === "BRL" ? "R$ " : `${currency} `;
  return `${sign}${prefix}${formatted}`;
}

export function signedClass(value: number, neutral = false): string {
  if (neutral || value === 0) return "text-muted-foreground";
  return value < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400";
}

export function todayIso(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function monthKey(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}
