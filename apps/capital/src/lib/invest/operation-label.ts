/** Ticker when it has characters, otherwise the holding name. A blank ticker is not a name. */
export function operationSubject(ticker: string | null | undefined, name: string | null | undefined): string {
  return ticker?.trim() || name?.trim() || "";
}

/** "Compra PETR4". A blank subject is the prefix alone, so the label is never "Compra ". */
export function operationLabel(prefix: string, ticker: string | null | undefined, name: string | null | undefined): string {
  const subject = operationSubject(ticker, name);
  return subject ? `${prefix} ${subject}` : prefix;
}
