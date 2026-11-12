import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * lib/claude.ts keeps its SDK client in a module-level singleton and reads
 * ANTHROPIC_API_KEY straight from process.env, so every test re-imports the
 * module (vi.resetModules) with the SDK replaced by a recording fake. No
 * network: `create` is a mock that each test scripts.
 */

const sdk = vi.hoisted(() => ({
  create: vi.fn(),
  constructed: [] as Array<{ apiKey?: string }>,
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: class FakeAnthropic {
    messages = { create: sdk.create };
    constructor(options: { apiKey?: string }) {
      sdk.constructed.push(options);
    }
  },
}));

const BILL_LABELS: Record<string, string> = {
  subscriptions: "Assinaturas",
  groceries: "Mercado",
  restaurants_dining: "Restaurantes",
  transportation: "Transporte",
  shopping: "Compras",
  entertainment: "Lazer",
  health_pharmacy: "Saúde",
  travel_system: "Viagem",
  education: "Educação",
  personal_care: "Cuidados",
  home: "Casa",
  software_tools: "Software",
  fees_charges: "Taxas",
  utilities: "Contas",
  other_system: "Outros",
  credit_card: "Cartão de crédito",
  other_income: "Outras receitas",
};
const CATEGORIES = ["Mercado", "Restaurantes", "Outros"];

type Claude = typeof import("../claude");

async function loadClaude(apiKey: string | undefined): Promise<Claude> {
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", apiKey ?? "");
  return import("../claude");
}

function reply(text: string, type = "text") {
  return { content: [{ type, text }] };
}

function transactions(count: number, withMerchant = false) {
  return Array.from({ length: count }, (_, index) => ({
    index,
    description: `COMPRA ${index}`,
    amount: 10 + index,
    ...(withMerchant ? { merchantName: `Loja ${index}` } : {}),
  }));
}

let warn: ReturnType<typeof vi.spyOn>;
let error: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  sdk.create.mockReset();
  sdk.constructed.length = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  error = vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("without ANTHROPIC_API_KEY", () => {
  it("categorizeBillTransactions answers every row with the fallback and never builds a client", async () => {
    const { categorizeBillTransactions } = await loadClaude(undefined);

    const result = await categorizeBillTransactions(transactions(3), CATEGORIES, "Outros", BILL_LABELS);

    expect(result).toEqual([
      { index: 0, category: "Outros" },
      { index: 1, category: "Outros" },
      { index: 2, category: "Outros" },
    ]);
    expect(sdk.constructed).toEqual([]);
    expect(sdk.create).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith("ANTHROPIC_API_KEY not set. Auto-categorization will be disabled.");
  });

  it("categorizeStatementTransactions answers every row with the fallback and never builds a client", async () => {
    const { categorizeStatementTransactions } = await loadClaude(undefined);

    const result = await categorizeStatementTransactions(
      transactions(2),
      CATEGORIES,
      "income",
      "Outras receitas",
      BILL_LABELS
    );

    expect(result).toEqual([
      { index: 0, category: "Outras receitas" },
      { index: 1, category: "Outras receitas" },
    ]);
    expect(sdk.constructed).toEqual([]);
    expect(sdk.create).not.toHaveBeenCalled();
  });

  it("returns an empty list for no transactions", async () => {
    const { categorizeBillTransactions } = await loadClaude(undefined);
    expect(await categorizeBillTransactions([], CATEGORIES, "Outros", BILL_LABELS)).toEqual([]);
  });
});

describe("categorizeBillTransactions", () => {
  it("sends the rows in one request and keeps the model's valid categories and suggestions", async () => {
    sdk.create.mockResolvedValue(
      reply(
        JSON.stringify([
          { index: 0, category: "Mercado" },
          { index: 1, category: "Outros", suggestedCategory: "Pet Shop" },
        ])
      )
    );
    const { categorizeBillTransactions } = await loadClaude("sk-test");

    const result = await categorizeBillTransactions(transactions(2, true), CATEGORIES, "Outros", BILL_LABELS);

    expect(result).toEqual([
      { index: 0, category: "Mercado", suggestedCategory: undefined },
      { index: 1, category: "Outros", suggestedCategory: "Pet Shop" },
    ]);
    expect(sdk.constructed).toEqual([{ apiKey: "sk-test" }]);
    expect(sdk.create).toHaveBeenCalledTimes(1);
    const request = sdk.create.mock.calls[0]![0] as {
      model: string;
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(request.model).toBe("claude-sonnet-4-20250514");
    expect(request.max_tokens).toBe(4096);
    expect(request.messages).toHaveLength(1);
    expect(request.messages[0]!.role).toBe("user");
    // The merchant is part of a bill row, the amount follows it.
    expect(request.messages[0]!.content).toContain('0. "COMPRA 0" (Merchant: Loja 0) - Amount: 10');
    expect(request.messages[0]!.content).toContain('1. "COMPRA 1" (Merchant: Loja 1) - Amount: 11');
    expect(request.messages[0]!.content).toContain("- Mercado");
  });

  it("omits the merchant when the row has none", async () => {
    sdk.create.mockResolvedValue(reply('[{"index":0,"category":"Mercado"}]'));
    const { categorizeBillTransactions } = await loadClaude("sk-test");

    await categorizeBillTransactions(transactions(1), CATEGORIES, "Outros", BILL_LABELS);

    const prompt = (sdk.create.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(prompt).toContain('0. "COMPRA 0" - Amount: 10');
    expect(prompt).not.toContain("Merchant:");
  });

  it("replaces a category the user does not have with the fallback", async () => {
    sdk.create.mockResolvedValue(reply('[{"index":0,"category":"Other"},{"index":1,"category":"Restaurantes"}]'));
    const { categorizeBillTransactions } = await loadClaude("sk-test");

    const result = await categorizeBillTransactions(transactions(2), CATEGORIES, "Outros", BILL_LABELS);

    expect(result.map((r) => r.category)).toEqual(["Outros", "Restaurantes"]);
  });

  it("unwraps a ```json fenced answer", async () => {
    sdk.create.mockResolvedValue(reply('```json\n[{"index":0,"category":"Mercado"}]\n```'));
    const { categorizeBillTransactions } = await loadClaude("sk-test");

    const result = await categorizeBillTransactions(transactions(1), CATEGORIES, "Outros", BILL_LABELS);

    expect(result).toEqual([{ index: 0, category: "Mercado", suggestedCategory: undefined }]);
    expect(error).not.toHaveBeenCalled();
  });

  it("unwraps a bare ``` fenced answer surrounded by whitespace", async () => {
    sdk.create.mockResolvedValue(reply('  ```\n[{"index":0,"category":"Restaurantes"}]\n```  '));
    const { categorizeBillTransactions } = await loadClaude("sk-test");

    const result = await categorizeBillTransactions(transactions(1), CATEGORIES, "Outros", BILL_LABELS);

    expect(result).toEqual([{ index: 0, category: "Restaurantes", suggestedCategory: undefined }]);
  });

  it("splits 120 rows into batches of 50 and keeps the order", async () => {
    sdk.create.mockImplementation(async (params: { messages: Array<{ content: string }> }) => {
      const prompt = params.messages[0]!.content;
      const indexes = [...prompt.matchAll(/^(\d+)\. "COMPRA/gm)].map((m) => Number(m[1]));
      return reply(JSON.stringify(indexes.map((index) => ({ index, category: "Mercado" }))));
    });
    const { categorizeBillTransactions } = await loadClaude("sk-test");

    const result = await categorizeBillTransactions(transactions(120), CATEGORIES, "Outros", BILL_LABELS);

    expect(sdk.create).toHaveBeenCalledTimes(3);
    const sizes = sdk.create.mock.calls.map(
      (call) => [...(call[0] as { messages: Array<{ content: string }> }).messages[0]!.content.matchAll(/^\d+\. "COMPRA/gm)].length
    );
    expect(sizes).toEqual([50, 50, 20]);
    expect(result).toHaveLength(120);
    expect(result.map((r) => r.index)).toEqual(Array.from({ length: 120 }, (_, i) => i));
    expect(result.every((r) => r.category === "Mercado")).toBe(true);
    // One client for the three requests.
    expect(sdk.constructed).toHaveLength(1);
  });

  it("falls back for the rows of a batch whose answer is not text, and logs it", async () => {
    sdk.create.mockResolvedValue({ content: [{ type: "tool_use", id: "t1", name: "x", input: {} }] });
    const { categorizeBillTransactions } = await loadClaude("sk-test");

    const result = await categorizeBillTransactions(transactions(2), CATEGORIES, "Outros", BILL_LABELS);

    expect(result).toEqual([
      { index: 0, category: "Outros" },
      { index: 1, category: "Outros" },
    ]);
    expect(error).toHaveBeenCalledWith("Claude categorization failed:", expect.objectContaining({ message: "Unexpected response type" }));
  });

  it("falls back when the answer is not valid JSON", async () => {
    sdk.create.mockResolvedValue(reply("Claro! Aqui está a categorização."));
    const { categorizeBillTransactions } = await loadClaude("sk-test");

    const result = await categorizeBillTransactions(transactions(1), CATEGORIES, "Outros", BILL_LABELS);

    expect(result).toEqual([{ index: 0, category: "Outros" }]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("falls back only for the batch whose request failed", async () => {
    sdk.create
      .mockResolvedValueOnce(
        reply(JSON.stringify(Array.from({ length: 50 }, (_, index) => ({ index, category: "Restaurantes" }))))
      )
      .mockRejectedValueOnce(new Error("overloaded"));
    const { categorizeBillTransactions } = await loadClaude("sk-test");

    const result = await categorizeBillTransactions(transactions(60), CATEGORIES, "Outros", BILL_LABELS);

    expect(result).toHaveLength(60);
    expect(result.slice(0, 50).every((r) => r.category === "Restaurantes")).toBe(true);
    expect(result.slice(50)).toEqual(Array.from({ length: 10 }, (_, i) => ({ index: 50 + i, category: "Outros" })));
    expect(error).toHaveBeenCalledWith("Claude categorization failed:", expect.objectContaining({ message: "overloaded" }));
  });
});

describe("categorizeStatementTransactions", () => {
  it("builds the statement prompt for the transaction type and keeps valid answers", async () => {
    sdk.create.mockResolvedValue(
      reply(
        JSON.stringify([
          { index: 0, category: "Outras receitas" },
          { index: 1, category: "Inventada", suggestedCategory: "Freelance" },
        ])
      )
    );
    const { categorizeStatementTransactions } = await loadClaude("sk-test");

    const result = await categorizeStatementTransactions(
      transactions(2, true),
      ["Outras receitas", "Salário"],
      "income",
      "Outras receitas",
      BILL_LABELS
    );

    expect(result).toEqual([
      { index: 0, category: "Outras receitas", suggestedCategory: undefined },
      { index: 1, category: "Outras receitas", suggestedCategory: "Freelance" },
    ]);
    expect(sdk.create).toHaveBeenCalledTimes(1);
    const request = sdk.create.mock.calls[0]![0] as { model: string; messages: Array<{ content: string }> };
    expect(request.model).toBe("claude-sonnet-4-20250514");
    const prompt = request.messages[0]!.content;
    expect(prompt).toContain("(income/credit)");
    // Statement rows carry no merchant, even when the input has one.
    expect(prompt).toContain('0. "COMPRA 0" - Amount: 10');
    expect(prompt).not.toContain("Merchant:");
  });

  it("uses the expense wording and the expense fallback for debits", async () => {
    sdk.create.mockResolvedValue(reply('[{"index":0,"category":"Mercado"}]'));
    const { categorizeStatementTransactions } = await loadClaude("sk-test");

    await categorizeStatementTransactions(transactions(1), CATEGORIES, "expense", "Outros", BILL_LABELS);

    const prompt = (sdk.create.mock.calls[0]![0] as { messages: Array<{ content: string }> }).messages[0]!.content;
    expect(prompt).toContain("(expense/debit)");
    expect(prompt).toContain('Use "Outros" only if absolutely no other category fits');
  });

  it("unwraps a fenced answer and batches 51 rows as 50 + 1", async () => {
    sdk.create.mockImplementation(async (params: { messages: Array<{ content: string }> }) => {
      const indexes = [...params.messages[0]!.content.matchAll(/^(\d+)\. "COMPRA/gm)].map((m) => Number(m[1]));
      return reply("```json\n" + JSON.stringify(indexes.map((index) => ({ index, category: "Mercado" }))) + "\n```");
    });
    const { categorizeStatementTransactions } = await loadClaude("sk-test");

    const result = await categorizeStatementTransactions(transactions(51), CATEGORIES, "expense", "Outros", BILL_LABELS);

    expect(sdk.create).toHaveBeenCalledTimes(2);
    expect(result).toHaveLength(51);
    expect(result[50]).toEqual({ index: 50, category: "Mercado", suggestedCategory: undefined });
  });

  it("falls back, and logs, when the answer is not text", async () => {
    sdk.create.mockResolvedValue({ content: [{ type: "thinking", thinking: "..." }] });
    const { categorizeStatementTransactions } = await loadClaude("sk-test");

    const result = await categorizeStatementTransactions(transactions(2), CATEGORIES, "expense", "Outros", BILL_LABELS);

    expect(result).toEqual([
      { index: 0, category: "Outros" },
      { index: 1, category: "Outros" },
    ]);
    expect(error).toHaveBeenCalledWith(
      "Claude statement categorization failed:",
      expect.objectContaining({ message: "Unexpected response type" })
    );
  });

  it("falls back when the request fails or the JSON is broken", async () => {
    sdk.create.mockRejectedValueOnce(new Error("429")).mockResolvedValueOnce(reply("[{"));
    const { categorizeStatementTransactions } = await loadClaude("sk-test");

    const failed = await categorizeStatementTransactions(transactions(1), CATEGORIES, "expense", "Outros", BILL_LABELS);
    const broken = await categorizeStatementTransactions(transactions(1), CATEGORIES, "expense", "Outros", BILL_LABELS);

    expect(failed).toEqual([{ index: 0, category: "Outros" }]);
    expect(broken).toEqual([{ index: 0, category: "Outros" }]);
    expect(error).toHaveBeenCalledTimes(2);
    // The client is built once and reused by the second call.
    expect(sdk.constructed).toHaveLength(1);
  });
});
