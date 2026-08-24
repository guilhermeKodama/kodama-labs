import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../../env";
import { parseJson } from "./anthropic";

const SuggestionSchema = z.object({
  sugestoes: z.array(
    z.object({
      tipo: z.enum(["bullet", "keyword", "context"]),
      texto_original: z.string().nullable(),
      texto_sugerido: z.string(),
      justificativa: z.string(),
    })
  ),
});

/**
 * Compares the default resume against one job and proposes edits — never
 * generates a resume from scratch. Each suggestion is stored as its own
 * ResumeSuggestion row so the editor can render it inline (old text struck
 * through, new text highlighted) and accept/reject individually. Accepting
 * edits the draft; the resume only becomes a new ResumeVersion when the
 * user explicitly saves — this function never writes to ResumeVersion.
 */
export async function generateSuggestions(jobId: string): Promise<{ count: number }> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
  const resume = await prisma.resumeVersion.findFirst({ where: { isDefault: true } });
  if (!resume) {
    throw new Error("Nenhum currículo padrão cadastrado — suba um em /curriculo antes de pedir sugestões.");
  }

  const contextDocs = await prisma.contextDocument.findMany({
    where: { includeInPrompt: true },
    orderBy: { sortOrder: "asc" },
  });

  const contextBlock = contextDocs.length
    ? contextDocs.map((d) => `### ${d.title}\n${d.bodyText.slice(0, 4000)}`).join("\n\n")
    : "(nenhum documento de contexto marcado para entrar no prompt)";

  const system = [
    "Você ajuda a adaptar um currículo já existente para uma vaga específica — NUNCA reescreve o currículo do zero.",
    "Proponha edições pontuais: reescrever um bullet para usar o vocabulário da vaga, adicionar uma keyword que falta,",
    "ou puxar uma conquista do material de contexto que ainda não está no currículo. Cada sugestão precisa apontar o",
    'texto_original exato que ela substitui (ou null se for uma adição nova) e o texto_sugerido completo. Responda em',
    "português do Brasil. No máximo 5 sugestões — priorize as que mais aumentam a aderência à vaga.",
  ].join(" ");

  const user = [
    `VAGA: ${job.title} @ ${job.company.name}`,
    `Stack: ${job.stack.join(", ") || "não especificada"}`,
    `Setor: ${job.sector ?? "não especificado"}`,
    "",
    "CURRÍCULO ATUAL:",
    resume.contentText,
    "",
    "MATERIAL DE CONTEXTO DISPONÍVEL:",
    contextBlock,
  ].join("\n");

  const result = await parseJson({
    model: env.SUGGEST_MODEL,
    systemBlocks: [{ type: "text", text: system }],
    user,
    schema: SuggestionSchema,
    maxTokens: 3000,
  });

  const llmCall = await prisma.llmCall.create({
    data: {
      purpose: "suggest",
      model: env.SUGGEST_MODEL,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      jobId: job.id,
    },
  });

  for (const s of result.data.sugestoes) {
    await prisma.resumeSuggestion.create({
      data: {
        jobId: job.id,
        resumeVersionId: resume.id,
        kind: s.tipo,
        beforeText: s.texto_original,
        afterText: s.texto_sugerido,
        rationale: s.justificativa,
        llmCallId: llmCall.id,
      },
    });
  }

  return { count: result.data.sugestoes.length };
}
