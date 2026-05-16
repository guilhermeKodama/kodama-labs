import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { env } from "@/env";
import Anthropic from "@anthropic-ai/sdk";
import { buildAlertI18n, renderPtBr } from "@sentinel/server/lib/alert-i18n";
import { getObjectBuffer } from "@/lib/storage/s3";

const BATCH_SIZE = 10;
const MODEL = "claude-sonnet-4-20250514";

const MAX_PDF_BUDGET_BYTES = 25 * 1024 * 1024;
const MAX_PDFS_PER_PROCUREMENT = 5;

const DOCUMENT_TYPE_PRIORITY: Record<string, number> = {
  edital: 0,
  "termo de referencia": 1,
  "termo de referência": 1,
  anexo: 2,
};

function documentRank(documentType: string): number {
  const normalized = documentType
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "");
  for (const [key, rank] of Object.entries(DOCUMENT_TYPE_PRIORITY)) {
    if (normalized.includes(key)) return rank;
  }
  return 3;
}

interface AttachedDocument {
  title: string;
  documentType: string;
  base64: string;
  sizeBytes: number;
}

interface DocumentRecord {
  title: string;
  documentType: string;
  mimeType: string;
  storageKey: string | null;
  sizeBytes: number;
}

async function loadAttachedDocuments(
  documents: DocumentRecord[],
): Promise<AttachedDocument[]> {
  const ranked = [...documents]
    .filter((d) => d.storageKey && d.mimeType === "application/pdf")
    .sort((a, b) => documentRank(a.documentType) - documentRank(b.documentType));

  const attached: AttachedDocument[] = [];
  let totalBytes = 0;

  for (const doc of ranked) {
    if (attached.length >= MAX_PDFS_PER_PROCUREMENT) break;
    if (!doc.storageKey) continue;
    try {
      const buffer = await getObjectBuffer(doc.storageKey);
      if (!buffer) {
        console.warn(
          `[analyze-ai] Missing S3 object for document key=${doc.storageKey}`,
        );
        continue;
      }
      if (totalBytes + buffer.length > MAX_PDF_BUDGET_BYTES) continue;
      attached.push({
        title: doc.title,
        documentType: doc.documentType,
        base64: buffer.toString("base64"),
        sizeBytes: buffer.length,
      });
      totalBytes += buffer.length;
    } catch (err) {
      console.warn(
        `[analyze-ai] Failed to load document ${doc.storageKey}:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return attached;
}

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
          documents: {
            where: {
              storageKey: { not: null },
              mimeType: "application/pdf",
            },
          },
        },
        orderBy: { riskScore: { sort: "desc", nulls: "last" } },
        take: BATCH_SIZE,
      });

      if (procurementsToAnalyze.length === 0) break;
      totalIn += procurementsToAnalyze.length;

      for (const procurement of procurementsToAnalyze) {
        try {
          const attachedDocs = await loadAttachedDocuments(procurement.documents);
          const context = buildAnalysisContext(procurement);
          const prompt = buildPrompt(context, attachedDocs);

          const userContent: Anthropic.MessageParam["content"] = [
            { type: "text", text: prompt },
            ...attachedDocs.map(
              (d): Anthropic.DocumentBlockParam => ({
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: d.base64,
                },
                title: d.title,
                context: d.documentType,
              }),
            ),
          ];

          const response = await anthropic.messages.create({
            model: MODEL,
            max_tokens: 2000,
            messages: [{ role: "user", content: userContent }],
          });

          const responseText =
            response.content[0]?.type === "text"
              ? response.content[0].text
              : "";

          const riskScore = extractRiskScore(responseText);
          const findings = {
            ...extractFindings(responseText),
            documentsAttached: attachedDocs.length,
          };

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
              const summary = (findings as { summary?: string }).summary ?? responseText.slice(0, 500);
              const i18nParams = {
                orgName: procurement.orgName,
                summary: summary.slice(0, 500),
              };
              const i18n = buildAlertI18n(
                "alerts.templates.aiFlag.title",
                "alerts.templates.aiFlag.description",
                i18nParams,
              );
              await prisma.alert.create({
                data: {
                  type: "AI_FLAG",
                  severity: riskScore >= 0.9 ? "CRITICAL" : "HIGH",
                  title: renderPtBr("alerts.templates.aiFlag.title", i18nParams),
                  description: renderPtBr("alerts.templates.aiFlag.description", i18nParams),
                  procurementId: procurement.id,
                  data: { riskScore, findings, i18n } as unknown as Prisma.InputJsonValue,
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

function buildPrompt(
  context: Record<string, unknown>,
  attachedDocs: AttachedDocument[],
): string {
  const docsSection =
    attachedDocs.length > 0
      ? `## Documentos Anexados
Os seguintes documentos PDF acompanham esta análise (anexados como blocos de documento):
${attachedDocs.map((d, i) => `${i + 1}. ${d.title} (${d.documentType}, ${Math.round(d.sizeBytes / 1024)} KB)`).join("\n")}

Considere o conteúdo dos documentos anexos ao examinar a licitação: escopo, especificações técnicas, exigências de habilitação, prazos, critérios de julgamento e cláusulas atípicas.
`
      : "";

  return `Você é um analista de dados públicos especializado em compras governamentais brasileiras. Sua tarefa é examinar os dados a seguir e **sinalizar possíveis inconsistências, padrões atípicos ou pontos que merecem revisão humana** — sem afirmar irregularidade, fraude, corrupção ou má-fé. Os dados são públicos; sua análise serve para orientar revisão posterior por auditores humanos.

## Diretrizes obrigatórias de linguagem
- NÃO use as palavras: "fraude", "corrupção", "criminal", "ilegal", "culpado", "suspeito", "conluio", "empresa de fachada".
- USE: "possível inconsistência", "atípico", "incomum", "fora da faixa esperada", "padrão a revisar", "vínculo a verificar", "sinaliza", "indica possível".
- Descreva fatos objetivos observados nos dados; não atribua intenção ou má-fé.
- Quando mencionar vínculos políticos, deixe claro que são padrões para verificação, não acusações.

## Dados da Licitação
${JSON.stringify(context, null, 2)}

${docsSection}## Instruções
1. Examine todos os dados fornecidos: descrição, valores, itens, fornecedores, sócios, sanções, vínculos políticos e alertas existentes${attachedDocs.length > 0 ? ", além do conteúdo dos documentos anexados (Edital, Termo de Referência, Anexos)" : ""}.
2. Sinalize padrões atípicos que mereçam revisão, como: preços fora da faixa esperada de referência, empresas com indicadores incomuns (capital baixo, recém-abertas, sócio único), participação simultânea de fornecedores com vínculos societários, possíveis conflitos de interesse com agentes públicos.
3. **VÍNCULOS POLÍTICOS**: ao examinar o campo "politicalConnections", descreva objetivamente:
   - Se há sócios de fornecedores que constam como políticos ativos ou ex-políticos.
   - Se fornecedores constam como doadores de campanha de políticos com atuação na mesma jurisdição.
   - Se doadores de campanha constam com contratos na região de atuação do político.
   - Se há padrão recorrente de proximidade entre doações e contratos.
4. Para cada ponto sinalizado, descreva a evidência observada e o nível de atenção sugerido (baixo, médio, alto).
5. Atribua um score geral de 0.0 (nenhum ponto a revisar) a 1.0 (muitos pontos a revisar). Vínculos políticos consistentes elevam o score, mas não constituem afirmação de irregularidade.

## Formato de Resposta
RISK_SCORE: [0.0-1.0]

OBSERVAÇÕES: [resumo objetivo em 2-3 frases, sem juízo de valor]

PONTOS A REVISAR:
- [ponto 1 com evidência observada nos dados]
- [ponto 2 com evidência observada nos dados]

VÍNCULOS A VERIFICAR:
- [vínculo identificado nos dados, com nível de atenção sugerido]

SUGESTÕES DE VERIFICAÇÃO:
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

  const summaryMatch = response.match(/OBSERVAÇÕES:\s*([\s\S]*?)(?=PONTOS A REVISAR:|$)/);
  if (summaryMatch) sections.summary = summaryMatch[1]!.trim();

  const findingsMatch = response.match(/PONTOS A REVISAR:\s*([\s\S]*?)(?=VÍNCULOS A VERIFICAR:|SUGESTÕES DE VERIFICAÇÃO:|$)/);
  if (findingsMatch) sections.findings = findingsMatch[1]!.trim();

  const linksMatch = response.match(/VÍNCULOS A VERIFICAR:\s*([\s\S]*?)(?=SUGESTÕES DE VERIFICAÇÃO:|$)/);
  if (linksMatch) sections.links = linksMatch[1]!.trim();

  const recsMatch = response.match(/SUGESTÕES DE VERIFICAÇÃO:\s*([\s\S]*?)$/);
  if (recsMatch) sections.recommendations = recsMatch[1]!.trim();

  return sections;
}
