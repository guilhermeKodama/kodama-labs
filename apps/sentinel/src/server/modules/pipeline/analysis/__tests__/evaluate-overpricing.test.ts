import { describe, it, expect, vi } from "vitest";
import {
  evaluateOverpricing,
  type EvaluateInput,
} from "../evaluate-overpricing";

vi.mock("@/env", () => ({
  env: { ANTHROPIC_API_KEY: "test-key" },
}));

vi.mock("@sentinel/server/lib/prisma", () => ({
  prisma: {
    procurement: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

const baseInput: EvaluateInput = {
  itemId: "item-1",
  itemDescription: "PRESTAÇÃO DE SERVIÇO",
  unit: "UN",
  quantity: 1,
  unitPrice: 900,
  totalPrice: 900,
  winningBid: 1810,
  estimatedPrice: 900,
  procurementId: "proc-1",
  procurementDescription:
    "Aquisição de peças de reposição para manutenção de maquinário Escavadeira Hidráulica New Holland E135",
  orgName: "MUNICIPIO DE MARCELINO RAMOS",
  state: "RS",
  city: "Marcelino Ramos",
  kind: "GENERIC",
  priceAnalyses: [
    {
      method: "bid_spread",
      isOverpriced: true,
      deviation: 101,
      medianGovPrice: 900,
      sampleSize: 1,
      confidence: "low",
    },
  ],
};

function mockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
        usage: { input_tokens: 100, output_tokens: 50 },
      }),
    },
  } as unknown as Parameters<typeof evaluateOverpricing>[1] extends infer T
    ? T extends { client?: infer C }
      ? C
      : never
    : never;
}

describe("evaluateOverpricing", () => {
  it("suppresses generic items when context is insufficient", async () => {
    const client = mockClient(
      `DECISION: suppress
SEVERITY:
ESTIMATE_MIN:
ESTIMATE_MAX:
ESTIMATE_EXPECTED:
ESTIMATE_SOURCES:
ENRICHED_ITEM_PTBR:
ENRICHED_ITEM_EN:
REASONING: Descrição genérica e contexto insuficiente para derivar faixa esperada.`,
    );

    const result = await evaluateOverpricing(baseInput, { client, skipSimilar: true });

    expect(result.decision).toBe("suppress");
    expect(result.severity).toBeUndefined();
    expect(result.derivedEstimate).toBeUndefined();
    expect(result.riskScore).toBeLessThan(0.2);
  });

  it("creates alert with derived estimate for service with rich context", async () => {
    const client = mockClient(
      `DECISION: create
SEVERITY: HIGH
ESTIMATE_MIN: 800
ESTIMATE_MAX: 1200
ESTIMATE_EXPECTED: 1000
ESTIMATE_SOURCES: LLM_KNOWLEDGE,PNCP_SIMILAR_CONTRACTS
ENRICHED_ITEM_PTBR: Serviço de manutenção de Escavadeira Hidráulica New Holland E135
ENRICHED_ITEM_EN: Maintenance service for New Holland E135 hydraulic excavator
REASONING: Serviço de manutenção em escavadeira hidráulica tem faixa típica entre R$ 800-1200; valor de R$ 1810 está bem acima.`,
    );

    const result = await evaluateOverpricing(
      { ...baseInput, kind: "SERVICE" },
      { client, skipSimilar: true },
    );

    expect(result.decision).toBe("create");
    expect(result.severity).toBe("HIGH");
    expect(result.derivedEstimate).toEqual({
      minPrice: 800,
      maxPrice: 1200,
      expectedPrice: 1000,
      rationale: "see REASONING",
      sources: ["LLM_KNOWLEDGE", "PNCP_SIMILAR_CONTRACTS"],
    });
    expect(result.enrichedItemLabel).toEqual({
      ptBr: "Serviço de manutenção de Escavadeira Hidráulica New Holland E135",
      en: "Maintenance service for New Holland E135 hydraulic excavator",
    });
  });

  it("creates alert for product with statistical baseline", async () => {
    const productInput: EvaluateInput = {
      ...baseInput,
      itemDescription: "ÓLEO HIDRÁULICO 20L NEW HOLLAND",
      kind: "PRODUCT",
      unitPrice: 450,
      totalPrice: 1350,
      priceAnalyses: [
        {
          method: "market_price",
          isOverpriced: true,
          deviation: 80,
          medianGovPrice: 250,
          sampleSize: 12,
          confidence: "high",
        },
      ],
    };
    const client = mockClient(
      `DECISION: create
SEVERITY: HIGH
ESTIMATE_MIN:
ESTIMATE_MAX:
ESTIMATE_EXPECTED:
ESTIMATE_SOURCES:
ENRICHED_ITEM_PTBR:
ENRICHED_ITEM_EN:
REASONING: Preço 80% acima da mediana de 12 referências PNCP com alta confiança.`,
    );

    const result = await evaluateOverpricing(productInput, { client, skipSimilar: true });

    expect(result.decision).toBe("create");
    expect(result.severity).toBe("HIGH");
    expect(result.derivedEstimate).toBeUndefined();
  });

  it("falls back to suppress when API errors out", async () => {
    const client = {
      messages: {
        create: vi.fn().mockRejectedValue(new Error("network timeout")),
      },
    } as unknown as Parameters<typeof mockClient>[0] extends never ? never : ReturnType<typeof mockClient>;

    const result = await evaluateOverpricing(baseInput, {
      client: client as unknown as ReturnType<typeof mockClient>,
      skipSimilar: true,
    });

    expect(result.decision).toBe("suppress");
    expect(result.reasoning).toContain("evaluator_unavailable");
    expect(result.reasoning).toContain("network timeout");
  });

  it("ignores unparseable responses and defaults to suppress", async () => {
    const client = mockClient("totally not the expected format");
    const result = await evaluateOverpricing(baseInput, { client, skipSimilar: true });
    expect(result.decision).toBe("suppress");
  });

  it("defaults to suppress when ANTHROPIC_API_KEY is missing", async () => {
    vi.resetModules();
    vi.doMock("@/env", () => ({ env: { ANTHROPIC_API_KEY: undefined } }));
    vi.doMock("@sentinel/server/lib/prisma", () => ({
      prisma: { procurement: { findMany: vi.fn().mockResolvedValue([]) } },
    }));
    const mod = await import("../evaluate-overpricing");
    const result = await mod.evaluateOverpricing(baseInput, { skipSimilar: true });
    expect(result.decision).toBe("suppress");
    expect(result.reasoning).toContain("no ANTHROPIC_API_KEY");
    expect(result.modelTokens).toBe(0);
  });

  it("does not return derived estimate when sources are empty", async () => {
    const client = mockClient(
      `DECISION: create
SEVERITY: MEDIUM
ESTIMATE_MIN: 100
ESTIMATE_MAX: 200
ESTIMATE_EXPECTED: 150
ESTIMATE_SOURCES:
ENRICHED_ITEM_PTBR:
ENRICHED_ITEM_EN:
REASONING: x`,
    );
    const result = await evaluateOverpricing(baseInput, { client, skipSimilar: true });
    expect(result.derivedEstimate).toBeUndefined();
  });
});
