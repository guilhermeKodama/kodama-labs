import Anthropic from "@anthropic-ai/sdk";
import { env } from "@/env";
import { prisma } from "@sentinel/server/lib/prisma";
import type { ItemKind } from "./classify-item";

const MODEL = "claude-sonnet-4-20250514";
const MAX_TOKENS = 1500;
const SIMILAR_CONTRACTS_LIMIT = 10;

export type EvaluateSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type EvaluateDecision = "create" | "suppress";

export type PriceAnalysisSummary = {
  method: string;
  isOverpriced: boolean;
  deviation: number;             // percentage
  medianGovPrice?: number | null;
  sampleSize?: number;
  confidence?: "high" | "medium" | "low";
};

export type EvaluateInput = {
  itemId: string;
  itemDescription: string;
  unit: string | null;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  winningBid?: number | null;
  estimatedPrice?: number | null;
  procurementId: string;
  procurementDescription: string;
  orgName: string;
  state: string | null;
  city: string | null;
  kind: ItemKind;
  /** Pre-computed statistical analyses for this item (zero or more). */
  priceAnalyses: PriceAnalysisSummary[];
};

export type DerivedEstimate = {
  minPrice: number;
  maxPrice: number;
  expectedPrice: number;
  rationale: string;
  sources: string[];
};

export type EvaluateVerdict = {
  decision: EvaluateDecision;
  severity?: EvaluateSeverity;
  reasoning: string;
  enrichedItemLabel?: { ptBr: string; en: string };
  derivedEstimate?: DerivedEstimate;
  prompt: string;
  response: string;
  riskScore: number;
  modelTokens: number;
};

let cachedClient: Anthropic | null = null;
function getClient(): Anthropic | null {
  if (!env.ANTHROPIC_API_KEY) return null;
  cachedClient ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  return cachedClient;
}

/**
 * Searches PNCP for procurements whose description contains overlapping
 * keywords from this procurement's description, scoped to the same state
 * when possible. Returns aggregated price stats from items in those
 * procurements that match the same keywords.
 */
async function findSimilarContractsContext(
  procurementDescription: string,
  state: string | null,
  excludeProcurementId: string,
): Promise<{
  count: number;
  median: number | null;
  min: number | null;
  max: number | null;
  examples: { description: string; unitPrice: number; totalPrice: number; orgName: string }[];
}> {
  const keywords = extractKeywords(procurementDescription);
  if (keywords.length === 0) {
    return { count: 0, median: null, min: null, max: null, examples: [] };
  }

  const primaryKeyword = keywords[0]!;

  const procurements = await prisma.procurement.findMany({
    where: {
      id: { not: excludeProcurementId },
      description: { contains: primaryKeyword, mode: "insensitive" },
      ...(state ? { state } : {}),
    },
    select: {
      id: true,
      orgName: true,
      items: {
        where: { totalPrice: { gt: 0 } },
        select: { description: true, unitPrice: true, totalPrice: true },
        take: 3,
      },
    },
    take: SIMILAR_CONTRACTS_LIMIT,
    orderBy: { publishedAt: "desc" },
  });

  const examples: { description: string; unitPrice: number; totalPrice: number; orgName: string }[] = [];
  const totals: number[] = [];
  for (const p of procurements) {
    for (const it of p.items) {
      const total = Number(it.totalPrice);
      if (total > 0) {
        totals.push(total);
        if (examples.length < 6) {
          examples.push({
            description: it.description,
            unitPrice: Number(it.unitPrice),
            totalPrice: total,
            orgName: p.orgName,
          });
        }
      }
    }
  }

  if (totals.length === 0) {
    return { count: 0, median: null, min: null, max: null, examples };
  }

  totals.sort((a, b) => a - b);
  const median = totals[Math.floor(totals.length / 2)]!;
  return {
    count: totals.length,
    median,
    min: totals[0]!,
    max: totals[totals.length - 1]!,
    examples,
  };
}

function extractKeywords(desc: string): string[] {
  // Drop common stopwords; keep nouns / equipment / model markers.
  const STOPWORDS = new Set([
    "DE", "DA", "DO", "DOS", "DAS", "PARA", "COM", "EM", "POR", "A", "O", "AS", "OS",
    "AQUISICAO", "AQUISIÇÃO", "CONTRATACAO", "CONTRATAÇÃO", "PRESTACAO", "PRESTAÇÃO",
    "SERVICO", "SERVIÇO", "SERVICOS", "SERVIÇOS", "FORNECIMENTO", "COMPRA",
  ]);
  return desc
    .toUpperCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Z0-9 ]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOPWORDS.has(w))
    .slice(0, 5);
}

export async function evaluateOverpricing(
  input: EvaluateInput,
  deps: { client?: Anthropic; skipSimilar?: boolean } = {},
): Promise<EvaluateVerdict> {
  const client = deps.client ?? getClient();

  // Fail-closed: default to suppress when evaluator unavailable
  if (!client) {
    return {
      decision: "suppress",
      reasoning: "evaluator_unavailable: no ANTHROPIC_API_KEY",
      prompt: "",
      response: "",
      riskScore: 0.1,
      modelTokens: 0,
    };
  }

  let similar: Awaited<ReturnType<typeof findSimilarContractsContext>> = {
    count: 0, median: null, min: null, max: null, examples: [],
  };
  if (!deps.skipSimilar && (input.kind === "SERVICE" || input.kind === "GENERIC")) {
    try {
      similar = await findSimilarContractsContext(
        input.procurementDescription,
        input.state,
        input.procurementId,
      );
    } catch (err) {
      console.error("[evaluate-overpricing] similar contracts query failed", err);
    }
  }

  const prompt = buildPrompt(input, similar);

  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
    });
    const responseText =
      response.content[0]?.type === "text" ? response.content[0].text : "";
    const parsed = parseResponse(responseText);
    const tokens = response.usage.input_tokens + response.usage.output_tokens;

    return {
      ...parsed,
      prompt,
      response: responseText,
      riskScore: decisionToRiskScore(parsed.decision, parsed.severity),
      modelTokens: tokens,
    };
  } catch (error) {
    return {
      decision: "suppress",
      reasoning: `evaluator_unavailable: ${error instanceof Error ? error.message : String(error)}`,
      prompt,
      response: "",
      riskScore: 0.1,
      modelTokens: 0,
    };
  }
}

function buildPrompt(
  input: EvaluateInput,
  similar: Awaited<ReturnType<typeof findSimilarContractsContext>>,
): string {
  const ctx = {
    classification: input.kind,
    item: {
      description: input.itemDescription,
      unit: input.unit,
      quantity: input.quantity,
      unitPrice: formatBRL(input.unitPrice),
      totalPrice: formatBRL(input.totalPrice),
      winningBid: input.winningBid !== null && input.winningBid !== undefined ? formatBRL(input.winningBid) : null,
      estimatedPrice: input.estimatedPrice !== null && input.estimatedPrice !== undefined ? formatBRL(input.estimatedPrice) : null,
    },
    procurement: {
      description: input.procurementDescription,
      orgName: input.orgName,
      state: input.state,
      city: input.city,
    },
    statisticalAnalyses: input.priceAnalyses.map((pa) => ({
      method: pa.method,
      flagged: pa.isOverpriced,
      deviationPct: `${pa.deviation.toFixed(0)}%`,
      median: pa.medianGovPrice ? formatBRL(pa.medianGovPrice) : null,
      sampleSize: pa.sampleSize ?? null,
      confidence: pa.confidence ?? null,
    })),
    similarContracts: {
      count: similar.count,
      medianTotal: similar.median !== null ? formatBRL(similar.median) : null,
      minTotal: similar.min !== null ? formatBRL(similar.min) : null,
      maxTotal: similar.max !== null ? formatBRL(similar.max) : null,
      examples: similar.examples.map((e) => ({
        description: e.description.slice(0, 80),
        unitPrice: formatBRL(e.unitPrice),
        totalPrice: formatBRL(e.totalPrice),
        org: e.orgName,
      })),
    },
  };

  const kindGuidance = buildKindGuidance(input.kind);

  return `Você é um avaliador de preços em compras públicas brasileiras. Sua tarefa é decidir se há indício suficiente de sobrepreço para gerar um alerta — ou se deve ser suprimido por falta de base comparativa confiável.

## Diretrizes obrigatórias de linguagem
- NÃO use: "fraude", "corrupção", "criminal", "ilegal", "culpado", "suspeito", "conluio", "empresa de fachada".
- USE: "possível inconsistência", "atípico", "fora da faixa esperada", "padrão a revisar", "indica possível".
- Descreva fatos observáveis; não atribua intenção.

## Princípio fundamental
**Falso positivo é pior que falso negativo.** Se você não tem base comparativa específica e confiável, suprima o alerta. Não dispare CRITICAL com argumentos genéricos.

${kindGuidance}

## Dados
${JSON.stringify(ctx, null, 2)}

## Enriquecimento de descrição
Se o item tem descrição genérica ("PRESTAÇÃO DE SERVIÇO", "MATERIAL DIVERSO", etc.) mas o contexto da licitação esclarece (equipamento, escopo), produza um ENRICHED_ITEM_PTBR e ENRICHED_ITEM_EN (até 100 chars cada) combinando ambos.

## Severidade
- CRITICAL: desvio > 100% acima da faixa esperada COM base sólida
- HIGH: 50-100% acima
- MEDIUM: 30-50% acima
- LOW: dentro de 30% mas com sinais de irregularidade contextual
Só atribua severidade quando decision=create.

## Faixa derivada
Quando você for capaz de estimar uma faixa esperada (kind=SERVICE ou GENERIC), preencha ESTIMATE_MIN, ESTIMATE_MAX, ESTIMATE_EXPECTED em reais (apenas o número, sem R$) e ESTIMATE_SOURCES (lista de fontes do seu raciocínio, ex: LLM_KNOWLEDGE,PNCP_SIMILAR_CONTRACTS). Se não consegue estimar com confiança, deixe vazios e decida=suppress.

## Formato de resposta (obrigatório, exatamente assim)
DECISION: create|suppress
SEVERITY: CRITICAL|HIGH|MEDIUM|LOW
ESTIMATE_MIN: <número ou vazio>
ESTIMATE_MAX: <número ou vazio>
ESTIMATE_EXPECTED: <número ou vazio>
ESTIMATE_SOURCES: <lista separada por vírgula ou vazio>
ENRICHED_ITEM_PTBR: <até 100 chars ou vazio>
ENRICHED_ITEM_EN: <até 100 chars ou vazio>
REASONING: <2-3 frases objetivas explicando a decisão>`;
}

function buildKindGuidance(kind: ItemKind): string {
  if (kind === "PRODUCT") {
    return `## Diretriz para PRODUTO
Este item é um bem físico, possivelmente identificável. Use as análises estatísticas (statisticalAnalyses) como base principal. **CREATE** apenas se:
- Pelo menos uma análise estatística tem isOverpriced=true E confidence ≥ medium E sampleSize ≥ 5.
- O desvio é claramente atribuível ao produto (não à variação esperada de marca/modelo).
**SUPPRESS** se: descrição não permite verificar se a amostra de comparação é mesmo equivalente; sampleSize < 5; confidence = low.`;
  }
  if (kind === "SERVICE") {
    return `## Diretriz para SERVIÇO
Este item é um serviço. Não há catálogo público de preços para serviços, e estatísticas literais são ruim. Use:
- O escopo descrito na licitação (equipamento, complexidade, quantidade, unidade)
- Contratos PNCP similares (similarContracts) na mesma região
- Seu conhecimento de mercado para o tipo de serviço

Derive uma faixa esperada (ESTIMATE_MIN..ESTIMATE_MAX). **CREATE** apenas se o totalPrice está acima do ESTIMATE_MAX por margem clara (>30%). **SUPPRESS** se não consegue derivar faixa com confiança razoável.`;
  }
  return `## Diretriz para GENERIC
A descrição do item é vaga ("PRESTAÇÃO DE SERVIÇO", "OUTROS", etc.). Só faz sentido analisar se a licitação dá contexto rico (equipamento, escopo). Mesmo com contexto, seja conservador. **SUPPRESS** é o default. **CREATE** apenas se você consegue derivar uma faixa confiável E o totalPrice está muito acima (>50% do ESTIMATE_MAX). Para genéricos, nunca atribua CRITICAL — máximo HIGH.`;
}

function parseResponse(text: string): {
  decision: EvaluateDecision;
  severity?: EvaluateSeverity;
  reasoning: string;
  enrichedItemLabel?: { ptBr: string; en: string };
  derivedEstimate?: DerivedEstimate;
} {
  const decisionMatch = text.match(/DECISION:[ \t]*(create|suppress)/i);
  const severityMatch = text.match(/SEVERITY:[ \t]*(CRITICAL|HIGH|MEDIUM|LOW)/i);
  const minMatch = text.match(/ESTIMATE_MIN:[ \t]*([^\n]*)/);
  const maxMatch = text.match(/ESTIMATE_MAX:[ \t]*([^\n]*)/);
  const expectedMatch = text.match(/ESTIMATE_EXPECTED:[ \t]*([^\n]*)/);
  const sourcesMatch = text.match(/ESTIMATE_SOURCES:[ \t]*([^\n]*)/);
  const ptBrMatch = text.match(/ENRICHED_ITEM_PTBR:[ \t]*([^\n]*)/);
  const enMatch = text.match(/ENRICHED_ITEM_EN:[ \t]*([^\n]*)/);
  const reasoningMatch = text.match(/REASONING:[ \t]*([\s\S]*?)$/);

  const decision = (decisionMatch?.[1]?.toLowerCase() ?? "suppress") as EvaluateDecision;
  const severityRaw = severityMatch?.[1]?.toUpperCase();
  const severity = severityRaw && ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(severityRaw)
    ? (severityRaw as EvaluateSeverity)
    : undefined;

  const minNum = parseNumber(minMatch?.[1]);
  const maxNum = parseNumber(maxMatch?.[1]);
  const expectedNum = parseNumber(expectedMatch?.[1]);
  const sources = (sourcesMatch?.[1] ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  const derivedEstimate: DerivedEstimate | undefined =
    minNum !== null && maxNum !== null && expectedNum !== null && sources.length > 0
      ? { minPrice: minNum, maxPrice: maxNum, expectedPrice: expectedNum, rationale: "see REASONING", sources }
      : undefined;

  const ptBr = ptBrMatch?.[1]?.trim() ?? "";
  const en = enMatch?.[1]?.trim() ?? "";
  const enrichedItemLabel = ptBr && en
    ? { ptBr: ptBr.slice(0, 100), en: en.slice(0, 100) }
    : undefined;

  const reasoning = reasoningMatch?.[1]?.trim().slice(0, 800) ?? "no_reasoning_parsed";

  return { decision, severity, reasoning, enrichedItemLabel, derivedEstimate };
}

function parseNumber(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[R$\s.]/g, "").replace(",", ".");
  const n = parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

function decisionToRiskScore(decision: EvaluateDecision, severity?: EvaluateSeverity): number {
  if (decision === "suppress") return 0.1;
  switch (severity) {
    case "CRITICAL": return 0.9;
    case "HIGH": return 0.75;
    case "MEDIUM": return 0.5;
    case "LOW": return 0.3;
    default: return 0.5;
  }
}

function formatBRL(value: number): string {
  return `R$${value.toFixed(2)}`;
}
