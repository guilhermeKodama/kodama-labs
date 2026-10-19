/** Last four digits only. Full account numbers are never stored or logged. */
export function maskAccountNumber(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return `••••${digits.slice(-4)}`;
}

/** Drop long digit runs (account numbers) from a message before it is logged or saved. */
export function redactNumbers(message: string): string {
  return message.replace(/\d{5,}/g, "••••").slice(0, 300);
}

/** Display name for a discovered Pluggy account. The number, when present, is masked. */
export function accountLabel(name: string | null | undefined, number: string | null | undefined): string {
  const label = (name ?? "").trim() || "Conta";
  const mask = maskAccountNumber(number);
  return mask ? `${label} ${mask}` : label;
}
