import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { env } from "@/env";
import Anthropic from "@anthropic-ai/sdk";

const BATCH_SIZE = 10;
const MODEL = "claude-sonnet-4-20250514";

export async function analyzeAi() {
  return runJob("analyze-ai", "analysis", async () => {
    if (!env.ANTHROPIC_API_KEY) {
      console.log("[analyze-ai] No ANTHROPIC_API_KEY set, skipping");
      return { recordsIn: 0, recordsOut: 0 };
    }

    const anthropic = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });

    let totalIn = 0;
    let recordsOut = 0;

    while (true) {
      const procurementsToAnalyze = await prisma.procurement.findMany({
        where: {
          analyses: { none: {} },
          alerts: { some: {} },
        },
        include: {
          items: {
            include: {
              priceAnalyses: true,
              priceReferences: true,
            },
          },
          contracts: {
            include: {
              entity: {
                include: {
                  shareholders: true,
                  sanctions: true,
                  politicalLinks: {
                    include: {
                      politician: {
                        select: { name: true, party: true, position: true, state: true },
                      },
                    },
                  },
                },
              },
            },
          },
          alerts: true,
        },
        orderBy: { riskScore: { sort: "desc", nulls: "last" } },
        take: BATCH_SIZE,
      });

      if (procurementsToAnalyze.length === 0) break;
      totalIn += procurementsToAnalyze.length;

      for (const procurement of procurementsToAnalyze) {
        try {
          const context = buildAnalysisContext(procurement);
          const prompt = buildPrompt(context);

          const response = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 2000,
            messages: [{ role: "user", content: prompt }],
          });

          const responseText =
            response.content[0]?.type === "text"
              ? response.content[0].text
              : "";

          const riskScore = extractRiskScore(responseText);
          const findings = extractFindings(responseText);

          await prisma.aiAnalysis.create({
            data: {
              targetType: "procurement",
              targetId: procurement.id,
              analysisType: "risk_assessment",
              prompt,
              response: responseText,
              riskScore,
              findings: findings as unknown as Prisma.InputJsonValue,
              model: MODEL,
              tokens: response.usage.input_tokens + response.usage.output_tokens,
              procurementId: procurement.id,
            },
          });

          await prisma.procurement.update({
            where: { id: procurement.id },
            data: { riskScore },
          });

          if (riskScore >= 0.7) {
            const existingAiAlert = await prisma.alert.findFirst({
              where: { type: "AI_FLAG", procurementId: procurement.id },
            });
            if (!existingAiAlert) {
              await prisma.alert.create({
                data: {
                  type: "AI_FLAG",
                  severity: riskScore >= 0.9 ? "CRITICAL" : "HIGH",
                  title: `IA identificou alto risco na licitação: ${procurement.orgName}`,
                  description: responseText.slice(0, 500),
                  procurementId: procurement.id,
                  data: { riskScore, findings } as unknown as Prisma.InputJsonValue,
                },
              });
            }
          }

          recordsOut++;
        } catch (error) {
          console.error(
            `[analyze-ai] Error analyzing procurement ${procurement.id}:`,
            error
          );
        }
      }

      if (procurementsToAnalyze.length < BATCH_SIZE) break;
    }

    return { recordsIn: totalIn, recordsOut };
  });
}

function buildAnalysisContext(procurement: Record<string, unknown>) {
  const p = procurement as {
    orgName: string;
    orgCnpj: string;
    description: string;
    modality: string;
    totalValue: { toString(): string } | null;
    state: string | null;
    city: string | null;
    items: {
      description: string;
      unitPrice: { toString(): string };
      quantity: { toString(): string };
      priceAnalyses: { isOverpriced: boolean; deviation: number; medianGovPrice: { toString(): string } | null }[];
    }[];
    contracts: {
      supplierName: string;
      supplierCnpj: string;
      value: { toString(): string };
      entity: {
        openDate: Date | null;
        capital: { toString(): string } | null;
        isShellCompany: boolean;
        shareholders: { name: string; role: string }[];
        sanctions: { source: string; reason: string }[];
        politicalLinks: {
          linkType: string;
          description: string;
          strength: number;
          politician: { name: string; party: string; position: string; state: string };
        }[];
      } | null;
    }[];
    alerts: { type: string; severity: string; title: string }[];
  };

  return {
    orgName: p.orgName,
    orgCnpj: p.orgCnpj,
    description: p.description,
    modality: p.modality,
    totalValue: p.totalValue?.toString(),
    location: [p.state, p.city].filter(Boolean).join(", "),
    items: p.items.map((i) => ({
      description: i.description,
      unitPrice: i.unitPrice.toString(),
      quantity: i.quantity.toString(),
      isOverpriced: i.priceAnalyses.some((pa) => pa.isOverpriced),
      deviation: i.priceAnalyses[0]?.deviation,
      medianPrice: i.priceAnalyses[0]?.medianGovPrice?.toString(),
    })),
    contracts: p.contracts.map((c) => ({
      supplier: c.supplierName,
      cnpj: c.supplierCnpj,
      value: c.value.toString(),
      entityAge: c.entity?.openDate
        ? `Aberta em ${c.entity.openDate.toISOString().split("T")[0]}`
        : "Data desconhecida",
      capital: c.entity?.capital?.toString(),
      isShellCompany: c.entity?.isShellCompany ?? false,
      shareholders: c.entity?.shareholders.map((s) => `${s.name} (${s.role})`),
      sanctions: c.entity?.sanctions.map(
        (s) => `${s.source}: ${s.reason}`
      ),
      politicalConnections: c.entity?.politicalLinks?.map((pl) => ({
        type: pl.linkType,
        politician: `${pl.politician.name} (${pl.politician.party}/${pl.politician.state} - ${pl.politician.position})`,
        description: pl.description,
        strength: pl.strength,
      })) ?? [],
    })),
    existingAlerts: p.alerts.map((a) => `[${a.severity}] ${a.type}: ${a.title}`),
  };
}

function buildPrompt(context: Record<string, unknown>): string {
  return `Você é um auditor especializado em compras públicas brasileiras. Analise a seguinte licitação e seus dados associados para identificar sinais de corrupção, fraude ou irregularidade.

## Dados da Licitação
${JSON.stringify(context, null, 2)}

## Instruções
1. Analise todos os dados fornecidos: descrição, valores, itens, fornecedores, sócios, sanções, conexões políticas e alertas existentes.
2. Identifique padrões suspeitos como: sobrepreço, empresas de fachada, conluio entre fornecedores, conflitos de interesse, direcionamento de licitação.
3. **CONEXÕES POLÍTICAS**: Preste atenção especial a fornecedores com conexões políticas (campo "politicalConnections"). Analise se:
   - Sócios de empresas fornecedoras são ou foram políticos
   - Empresas fornecedoras doaram para campanhas de políticos que atuam na mesma jurisdição
   - Doadores de campanha receberam contratos na região de atuação do político
   - Existe padrão de favorecimento baseado em conexões políticas
4. Para cada problema identificado, explique a evidência e o nível de risco.
5. Atribua um score de risco geral de 0.0 (sem risco) a 1.0 (alto risco). Conexões políticas fortes devem aumentar significativamente o score.

## Formato de Resposta
RISK_SCORE: [0.0-1.0]

RESUMO: [resumo executivo em 2-3 frases]

ACHADOS:
- [achado 1 com evidência]
- [achado 2 com evidência]

CONEXÕES POLÍTICAS:
- [conexão política encontrada com análise de risco]

RECOMENDAÇÕES:
- [ação recomendada 1]
- [ação recomendada 2]`;
}

function extractRiskScore(response: string): number {
  const match = response.match(/RISK_SCORE:\s*([\d.]+)/);
  if (match) {
    const score = parseFloat(match[1]!);
    return Math.min(1, Math.max(0, score));
  }
  return 0.5;
}

function extractFindings(response: string): Record<string, unknown> {
  const sections: Record<string, string> = {};

  const summaryMatch = response.match(/RESUMO:\s*([\s\S]*?)(?=ACHADOS:|$)/);
  if (summaryMatch) sections.summary = summaryMatch[1]!.trim();

  const findingsMatch = response.match(/ACHADOS:\s*([\s\S]*?)(?=RECOMENDAÇÕES:|$)/);
  if (findingsMatch) sections.findings = findingsMatch[1]!.trim();

  const recsMatch = response.match(/RECOMENDAÇÕES:\s*([\s\S]*?)$/);
  if (recsMatch) sections.recommendations = recsMatch[1]!.trim();

  return sections;
}
