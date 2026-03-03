export function normalizeDescription(description: string): string {
  return description.toLowerCase().trim();
}

/**
 * Extract a short, human-readable title from a verbose OFX bank statement memo.
 * Examples:
 *   "Transferência enviada pelo Pix - Fabiano Barbosa - •••.853.628-•• - BCO SANTANDER..."
 *     → "Pix enviado - Fabiano Barbosa"
 *   "Transferência recebida pelo Pix - KODAMA SOFTWARE ENGI - 41.737..."
 *     → "Pix recebido - KODAMA SOFTWARE ENGI"
 *   "Compra no débito - PADARIA IMIGRANTES"
 *     → "PADARIA IMIGRANTES"
 *   "Pagamento de boleto efetuado - ASSOCIACAO DOS PROPRIETARIOS..."
 *     → "Boleto - ASSOCIACAO DOS PROPRIETARIOS"
 *   "Aplicação RDB" → "Aplicação RDB"
 *   "Pagamento de fatura" → "Pagamento de fatura"
 */
export function extractShortTitle(memo: string): string {
  const m = memo.trim();

  // Pix sent
  const pixSent = m.match(/^Transferência enviada pelo Pix\s*-\s*([^-]+)/i);
  if (pixSent) {
    return `Pix enviado - ${pixSent[1].trim()}`;
  }

  // Pix sent via Open Banking - extract the entity being paid
  const pixOpenBank = m.match(/^Transferência enviada pelo Pix via Open Banking\s*-\s*[^-]+-\s*([^-]+)/i);
  if (pixOpenBank) {
    return `Pix enviado - ${pixOpenBank[1].trim()}`;
  }

  // Pix received
  const pixReceived = m.match(/^Transferência recebida pelo Pix\s*-\s*([^-]+)/i);
  if (pixReceived) {
    return `Pix recebido - ${pixReceived[1].trim()}`;
  }

  // Debit card purchase
  const debit = m.match(/^Compra no débito\s*-\s*(.+)/i);
  if (debit) {
    return debit[1].trim();
  }

  // Boleto payment
  const boleto = m.match(/^Pagamento de boleto efetuado\s*-\s*([^-]+)/i);
  if (boleto) {
    return `Boleto - ${boleto[1].trim()}`;
  }

  // Short memos pass through as-is (Aplicação RDB, Resgate RDB, Pagamento de fatura, etc.)
  return m;
}
