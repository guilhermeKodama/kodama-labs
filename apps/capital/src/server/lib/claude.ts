import Anthropic from "@anthropic-ai/sdk";

let anthropicClient: Anthropic | null = null;

function getClient(): Anthropic | null {
  if (anthropicClient) return anthropicClient;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn("ANTHROPIC_API_KEY not set. Auto-categorization will be disabled.");
    return null;
  }

  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

interface BillTransactionInput {
  index: number;
  description: string;
  merchantName?: string;
  amount: number;
}

interface CategorizationResult {
  index: number;
  category: string;
}

/**
 * Use Claude to auto-categorize credit card bill transactions.
 * Falls back to "Other" category if API is unavailable or fails.
 */
export async function categorizeBillTransactions(
  transactions: BillTransactionInput[],
  availableCategories: string[]
): Promise<CategorizationResult[]> {
  const client = getClient();

  if (!client) {
    // Fallback: assign "Other" to all transactions
    return transactions.map((t) => ({
      index: t.index,
      category: "Other",
    }));
  }

  // Process in batches of 50 to avoid token limits
  const BATCH_SIZE = 50;
  const results: CategorizationResult[] = [];

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    const batchResults = await categorizeBatch(client, batch, availableCategories);
    results.push(...batchResults);
  }

  return results;
}

async function categorizeBatch(
  client: Anthropic,
  transactions: BillTransactionInput[],
  availableCategories: string[]
): Promise<CategorizationResult[]> {
  const transactionList = transactions
    .map(
      (t) =>
        `${t.index}. "${t.description}"${t.merchantName ? ` (Merchant: ${t.merchantName})` : ""} - Amount: ${t.amount}`
    )
    .join("\n");

  const prompt = `You are a financial categorization assistant. Categorize each credit card transaction into one of the available categories.

Available categories:
${availableCategories.map((c) => `- ${c}`).join("\n")}

Transactions to categorize:
${transactionList}

Rules:
- Assign exactly one category per transaction from the available list.
- Use "Subscriptions" for recurring services (Netflix, Spotify, iCloud, etc.).
- Use "Groceries" for supermarkets and food stores.
- Use "Restaurants & Dining" for restaurants, delivery apps, cafes.
- Use "Transportation" for Uber, gas stations, parking, tolls.
- Use "Shopping" for retail stores, online shopping (Amazon, etc.).
- Use "Entertainment" for movies, games, events, streaming services not clearly subscriptions.
- Use "Health & Pharmacy" for drugstores, medical appointments.
- Use "Travel" for hotels, flights, travel agencies.
- Use "Education" for courses, books, school-related.
- Use "Personal Care" for beauty, gym, wellness.
- Use "Home" for furniture, maintenance, home improvement.
- Use "Fees & Charges" for bank fees, interest charges, card fees.
- Use "Utilities" for phone bills, internet, electricity.
- Use "Other" only if no other category fits.

Respond ONLY with a valid JSON array, no other text:
[{"index": 0, "category": "CategoryName"}, ...]`;

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      throw new Error("Unexpected response type");
    }

    // Extract JSON from response (handle possible markdown wrapping)
    let jsonStr = content.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr) as CategorizationResult[];

    // Validate categories are in the allowed list
    return parsed.map((r) => ({
      index: r.index,
      category: availableCategories.includes(r.category) ? r.category : "Other",
    }));
  } catch (error) {
    console.error("Claude categorization failed:", error);
    // Fallback to "Other"
    return transactions.map((t) => ({
      index: t.index,
      category: "Other",
    }));
  }
}
