import { z } from "zod";
import { prisma } from "../lib/prisma";
import { env } from "../../env";
import { parseJson } from "../llm/anthropic";
import { getActiveProfile } from "../modules/search-profile";

const RECENT_WINDOW_DAYS = 14;
const MIN_DECISIONS_TO_DISTILL = 8;

const ProposalSchema = z.object({
  proposals: z.array(
    z.object({
      regra: z.string(),
      campo_alvo: z.enum(["doNotWant", "wantToDo", "avoidStack", "excludedCompanies"]),
      raciocinio: z.string(),
      indices_evidencia: z.array(z.number().int()),
    })
  ),
});

/**
 * Reads the user's recent triage decisions (with their reasons) and asks
 * Claude to spot a pattern worth writing into the profile as an explicit
 * rule — the same move the user made by hand on 2026-07-28, when two
 * discards (PostHog Context Engineer, Railway Observability) became the
 * "constrói vs opera" rule in _config.yaml. Never applied automatically:
 * every proposal lands as a PENDING ProfileRuleProposal for /perfil to
 * show, accept, or reject.
 */
export async function distillRules(): Promise<{ proposalsCreated: number }> {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const decisions = await prisma.triageDecision.findMany({
    where: { decidedAt: { gte: since }, reason: { not: null } },
    include: { job: { include: { company: true } } },
    orderBy: { decidedAt: "desc" },
    take: 40,
  });

  if (decisions.length < MIN_DECISIONS_TO_DISTILL) {
    return { proposalsCreated: 0 };
  }

  const profile = await getActiveProfile();

  const evidenceLines = decisions
    .map((d, i) => `[${i}] ${d.job?.company.name ?? "?"} — "${d.job?.title ?? "?"}" — ${d.label} — motivo: "${d.reason}"`)
    .join("\n");

  const system = [
    "Você lê decisões de triagem recentes de um usuário buscando emprego e procura PADRÕES que valham a pena virar",
    "uma regra explícita no perfil de busca dele. Só proponha uma regra quando pelo menos 2 decisões apontarem",
    "claramente para o mesmo motivo — não generalize a partir de uma única decisão isolada.",
    "Responda em português do Brasil. Cada proposta precisa citar os índices das decisões que a evidenciam.",
  ].join(" ");

  const user = [
    `NÃO QUERO atual do perfil: ${profile.doNotWant.join(" | ") || "(vazio)"}`,
    `QUERO FAZER atual do perfil: ${profile.wantToDo.join(" | ") || "(vazio)"}`,
    "",
    "DECISÕES RECENTES:",
    evidenceLines,
  ].join("\n");

  const result = await parseJson({
    model: env.SCORE_MODEL,
    systemBlocks: [{ type: "text", text: system }],
    user,
    schema: ProposalSchema,
    maxTokens: 1500,
  });

  await prisma.llmCall.create({
    data: {
      purpose: "distill_rules",
      model: env.SCORE_MODEL,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    },
  });

  let created = 0;
  for (const proposal of result.data.proposals) {
    const evidenceJobIds = proposal.indices_evidencia
      .map((i) => decisions[i]?.jobId)
      .filter((id): id is string => Boolean(id));
    if (evidenceJobIds.length < 2) continue; // guard even if the model didn't follow the "2+" instruction

    await prisma.profileRuleProposal.create({
      data: {
        profileVersionId: profile.id,
        proposedRule: proposal.regra,
        targetField: proposal.campo_alvo,
        evidenceJobIds,
        rationale: proposal.raciocinio,
        status: "PENDING",
      },
    });
    created++;
  }

  return { proposalsCreated: created };
}
