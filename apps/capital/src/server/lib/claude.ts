import Anthropic from "@anthropic-ai/sdk";
import {
  buildBillCategoryPrompt,
  buildStatementCategoryPrompt,
  coerceToAvailableCategory,
} from "./category-prompt";

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

export interface CategorizationResult {
  index: number;
  category: string;
  suggestedCategory?: string; // AI-suggested new category when none fit well
}

/**
 * Use Claude to auto-categorize credit card bill transactions.
 * `fallbackCategory` is the user's current name for systemKey other_system.
 * `labels` maps systemKey -> the user's current category name.
 */
export async function categorizeBillTransactions(
  transactions: BillTransactionInput[],
  availableCategories: string[],
  fallbackCategory: string,
  labels: Record<string, string>
): Promise<CategorizationResult[]> {
  const client = getClient();

  if (!client) {
    return transactions.map((t) => ({
      index: t.index,
      category: fallbackCategory,
    }));
  }

  // Process in batches of 50 to avoid token limits
  const BATCH_SIZE = 50;
  const results: CategorizationResult[] = [];

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    const batchResults = await categorizeBatch(client, batch, availableCategories, fallbackCategory, labels);
    results.push(...batchResults);
  }

  return results;
}

/**
 * Use Claude to auto-categorize bank statement transactions.
 * Adapted prompt for bank statement descriptions (Pix, boleto, debit card, etc.)
 */
export async function categorizeStatementTransactions(
  transactions: BillTransactionInput[],
  availableCategories: string[],
  transactionType: "expense" | "income",
  fallbackCategory: string,
  labels: Record<string, string>
): Promise<CategorizationResult[]> {
  const client = getClient();

  if (!client) {
    return transactions.map((t) => ({ index: t.index, category: fallbackCategory }));
  }

  const BATCH_SIZE = 50;
  const results: CategorizationResult[] = [];

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE);
    const batchResults = await categorizeStatementBatch(
      client,
      batch,
      availableCategories,
      transactionType,
      fallbackCategory,
      labels
    );
    results.push(...batchResults);
  }

  return results;
}

async function categorizeStatementBatch(
  client: Anthropic,
  transactions: BillTransactionInput[],
  availableCategories: string[],
  transactionType: "expense" | "income",
  fallbackCategory: string,
  labels: Record<string, string>
): Promise<CategorizationResult[]> {
  const transactionList = transactions
    .map((t) => `${t.index}. "${t.description}" - Amount: ${t.amount}`)
    .join("\n");

  const prompt = buildStatementCategoryPrompt(
    transactionList,
    availableCategories,
    labels,
    transactionType
  );

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
    });

    const content = response.content[0];
    if (content.type !== "text") throw new Error("Unexpected response type");

    let jsonStr = content.text.trim();
    if (jsonStr.startsWith("```")) {
      jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
    }

    const parsed = JSON.parse(jsonStr) as CategorizationResult[];
    return parsed.map((r) => ({
      index: r.index,
      category: coerceToAvailableCategory(r.category, availableCategories, fallbackCategory),
      suggestedCategory: r.suggestedCategory || undefined,
    }));
  } catch (error) {
    console.error("Claude statement categorization failed:", error);
    return transactions.map((t) => ({ index: t.index, category: fallbackCategory }));
  }
}

async function categorizeBatch(
  client: Anthropic,
  transactions: BillTransactionInput[],
  availableCategories: string[],
  fallbackCategory: string,
  labels: Record<string, string>
): Promise<CategorizationResult[]> {
  const transactionList = transactions
    .map(
      (t) =>
        `${t.index}. "${t.description}"${t.merchantName ? ` (Merchant: ${t.merchantName})` : ""} - Amount: ${t.amount}`
    )
    .join("\n");

  const prompt = buildBillCategoryPrompt(transactionList, availableCategories, labels);

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
      category: coerceToAvailableCategory(r.category, availableCategories, fallbackCategory),
      suggestedCategory: r.suggestedCategory || undefined,
    }));
  } catch (error) {
    console.error("Claude categorization failed:", error);
    return transactions.map((t) => ({
      index: t.index,
      category: fallbackCategory,
    }));
  }
}
