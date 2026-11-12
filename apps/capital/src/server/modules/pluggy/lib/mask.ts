/** Last four digits, or null when the value has fewer than four. Full numbers are never stored. */
export function last4Digits(value: string | null | undefined): string | null {
  const digits = (value ?? "").replace(/\D/g, "");
  return digits.length >= 4 ? digits.slice(-4) : null;
}

/** Last four digits only. Full account numbers are never stored or logged. */
export function maskAccountNumber(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D/g, "");
  if (!digits) return "";
  return `••••${digits.slice(-4)}`;
}

/**
 * Drop CPF, CNPJ and other long digit runs. Formatted documents
 * (123.456.789-00, 12.345.678/0001-90) count too.
 */
export function redactForModel(message: string): string {
  return message
    .replace(/\d{5,}/g, "••••")
    .replace(/\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}/g, "••••")
    .replace(/\d{3}\.\d{3}\.\d{3}-\d{2}/g, "••••");
}

/** Drop long digit runs from a message before it is logged or saved. */
export function redactNumbers(message: string): string {
  return redactForModel(message).slice(0, 300);
}

/** Display name for a discovered Pluggy account. The number, when present, is masked. */
export function accountLabel(name: string | null | undefined, number: string | null | undefined): string {
  const label = (name ?? "").trim() || "Conta";
  const mask = maskAccountNumber(number);
  return mask ? `${label} ${mask}` : label;
}
