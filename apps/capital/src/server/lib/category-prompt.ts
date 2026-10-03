/**
 * Pure helpers for AI categorization prompts.
 * Callers pass the user's current category names (resolved by systemKey).
 */

export const BILL_LABEL_KEYS = [
  "subscriptions",
  "groceries",
  "restaurants_dining",
  "transportation",
  "shopping",
  "entertainment",
  "health_pharmacy",
  "travel_system",
  "education",
  "personal_care",
  "home",
  "software_tools",
  "fees_charges",
  "utilities",
  "other_system",
] as const;

export const STATEMENT_LABEL_KEYS = [
  "credit_card",
  "other_system",
  "other_income",
] as const;

export function label(labels: Record<string, string>, key: string): string {
  const name = labels[key];
  if (!name) {
    throw new Error(`Missing category label for system key ${key}`);
  }
  return name;
}

/** Keep a model answer only when it is one of the user's categories. */
export function coerceToAvailableCategory(
  category: string,
  available: string[],
  fallback: string
): string {
  return available.includes(category) ? category : fallback;
}

export function buildBillCategoryPrompt(
  transactionList: string,
  availableCategories: string[],
  labels: Record<string, string>
): string {
  const other = label(labels, "other_system");
  return `You are a financial categorization assistant for Brazilian credit card bills. Categorize each transaction into one of the available categories.

Available categories:
${availableCategories.map((c) => `- ${c}`).join("\n")}

Transactions to categorize:
${transactionList}

Rules:
- Assign exactly one category per transaction from the available list.
- Use "${label(labels, "subscriptions")}" for recurring digital services (Netflix, Spotify, iCloud, Amazon Prime, Disney+, etc.).
- Use "${label(labels, "groceries")}" for supermarkets, food stores, mercados, sacolão, açougue (e.g. Shop Fartura, Centro de Abastecimento, Mikami Mercearia).
- Use "${label(labels, "restaurants_dining")}" for restaurants, delivery apps, cafes, bakeries, ice cream shops, lanchonetes (e.g. Beraldo Di Cale, Padaria, Sorveteria).
- Use "${label(labels, "transportation")}" for Uber, gas stations (Posto), parking, tolls (Sem Parar), car rental (Localiza).
- Use "${label(labels, "shopping")}" for retail stores, online shopping (Amazon, Mercadolivre, Shopee, Cobasi, Centauro, etc.).
- Use "${label(labels, "entertainment")}" for movies (Cinemas Kinoplex), games (Steam, PlayStation), events.
- Use "${label(labels, "health_pharmacy")}" for drugstores (Drogasil), medical appointments, pharmacies.
- Use "${label(labels, "travel_system")}" for hotels (Booking, Ibis), flights (Latam, Azul, Decolar), travel agencies.
- Use "${label(labels, "education")}" for courses, books, bookstores (Leitura), school-related, libraries.
- Use "${label(labels, "personal_care")}" for beauty, gym (Lifebox), wellness, O Boticário.
- Use "${label(labels, "home")}" for furniture, maintenance, home improvement (Leroy Merlin).
- Use "${label(labels, "software_tools")}" for developer/work tools (Cursor, GitHub, OpenAI, Anthropic, CompanyHero).
- Use "${label(labels, "fees_charges")}" for bank fees, interest charges, IOF, card fees, "Ajuste a crédito", "Estorno".
- Use "${label(labels, "utilities")}" for phone bills, internet, electricity.
- Use "${other}" only if absolutely no other category fits.
- If you assign "${other}" because no existing category fits, also provide a suggestedCategory with a short name for what a better category would be.

Respond ONLY with a valid JSON array, no other text:
[{"index": 0, "category": "${label(labels, "groceries")}"}, {"index": 1, "category": "${other}", "suggestedCategory": "Pet Supplies"}, ...]

Only include "suggestedCategory" when you assign "${other}" and believe a new category would be useful.`;
}

export function buildStatementCategoryPrompt(
  transactionList: string,
  availableCategories: string[],
  labels: Record<string, string>,
  transactionType: "expense" | "income"
): string {
  const fallback = transactionType === "income"
    ? label(labels, "other_income")
    : label(labels, "other_system");
  const typeLabel = transactionType === "income" ? "income/credit" : "expense/debit";
  const creditCard = label(labels, "credit_card");

  return `You are a financial categorization assistant for Brazilian bank statement transactions (${typeLabel}). Categorize each transaction into one of the available categories.

Available categories:
${availableCategories.map((c) => `- ${c}`).join("\n")}

Transactions to categorize:
${transactionList}

Rules:
- Assign exactly one category per transaction from the available list.
- These are bank statement descriptions, not credit card merchants. Common patterns:
  - "Transferência enviada/recebida pelo Pix - RECIPIENT - CNPJ/CPF - BANK" — Pix transfer
  - "Pagamento de boleto efetuado - ENTITY" — bill/boleto payment
  - "Compra no débito - STORE" — debit card purchase
  - "Aplicação RDB" / "Resgate RDB" — investment (RDB application/redemption)
  - "Pagamento de fatura" — credit card bill payment
- For Pix transfers, categorize based on the RECIPIENT name and context.
- "Pagamento de fatura" should be "${creditCard}" (expense) or skipped (income).
- "Aplicação/Resgate RDB" is investment-related.
- Use "${fallback}" only if absolutely no other category fits.

Respond ONLY with a valid JSON array, no other text:
[{"index": 0, "category": "${availableCategories[0] ?? fallback}"}, {"index": 1, "category": "${fallback}"}, ...]`;
}
