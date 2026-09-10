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

// avoidStack and excludedCompanies are matched mechanically — avoidStack as a
// \bterm\b regex on the title and an exact token against Job.stack,
// excludedCompanies as a substring of Company.name — so they only ever accept
// a bare name. doNotWant/wantToDo are prose fed verbatim to the rubric and
// accept anything. Existing valid values ("C / C++", "Canonical") set the
// bar: a few words, no sentence punctuation.
const MECHANICAL_FIELDS = new Set(["avoidStack", "excludedCompanies"]);

function isMechanicalFieldValueValid(field: string, rule: string): boolean {
  if (!MECHANICAL_FIELDS.has(field)) return true;
  const trimmed = rule.trim();
  return trimmed.length <= 30 && trimmed.split(/\s+/).length <= 3 && !/[.,;:()]/.test(trimmed);
}

/**
 * Reads the user's recent triage decisions (with their reasons) and asks
 * Claude to spot a pattern worth writing into the profile as an explicit
 * rule — the same move the user made by hand on 2026-07-28, when two
 * discards (PostHog Context Engineer, Railway Observability) became the
 * "constrói vs opera" rule in _config.yaml. Never applied automatically:
 * every proposal lands as a PENDING ProfileRuleProposal for /perfil to
 * show, accept, or reject.
 */
export async function distillRules(): Promise<{ proposalsCreated: number; proposalsRejected: number }> {
  const since = new Date(Date.now() - RECENT_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const decisions = await prisma.triageDecision.findMany({
    where: { decidedAt: { gte: since }, reason: { not: null } },
    include: { job: { include: { company: true } } },
    orderBy: { decidedAt: "desc" },
    take: 40,
  });

  if (decisions.length < MIN_DECISIONS_TO_DISTILL) {
    return { proposalsCreated: 0, proposalsRejected: 0 };
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
    "",
    "O campo_alvo decide COMO a regra é aplicada, e escolher errado produz uma regra que não faz nada:",
    "- doNotWant / wantToDo: PROSA livre, lida literalmente pelo avaliador. É o único campo que aceita uma frase.",
    "  Toda regra sobre TIPO DE PAPEL, responsabilidade, setor, formato de contrato ou cultura vai aqui.",
    "- avoidStack: SÓ nome de tecnologia (ex: \"Java\", \"PHP\", \"C / C++\"). É casado mecanicamente como palavra",
    "  exata no título da vaga e como token exato na lista de tecnologias dela. Uma frase aqui não casa com nada",
    "  E AINDA enfraquece as tecnologias que já estão no campo. Nunca ponha frase aqui.",
    "- excludedCompanies: SÓ nome de empresa (ex: \"Canonical\", \"Kraken\"). É casado como substring do nome da",
    "  empresa. \"Descartar empresas cripto\" NÃO funciona — nomeie as empresas, uma proposta por empresa.",
    "Em dúvida entre um campo mecânico e um de prosa, escolha o de prosa.",
  ].join(" ");

  const user = [
    `NÃO QUERO atual do perfil: ${profile.doNotWant.join(" | ") || "(vazio)"}`,
    `QUERO FAZER atual do perfil: ${profile.wantToDo.join(" | ") || "(vazio)"}`,
    // Shown so the model can see the SHAPE these two fields accept — bare
    // names, never sentences — instead of inferring it from the field name.
    `avoidStack atual (só tecnologias): ${profile.avoidStack.join(" | ") || "(vazio)"}`,
    `excludedCompanies atual (só empresas): ${profile.excludedCompanies.join(" | ") || "(vazio)"}`,
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
  let rejected = 0;
  for (const proposal of result.data.proposals) {
    const evidenceJobIds = proposal.indices_evidencia
      .map((i) => decisions[i]?.jobId)
      .filter((id): id is string => Boolean(id));
    if (evidenceJobIds.length < 2) continue; // guard even if the model didn't follow the "2+" instruction

    // Backstop for the field semantics spelled out in the system prompt. A
    // sentence in a mechanically-matched field produces a rule that LOOKS
    // accepted and does nothing, which is worse than no proposal at all: on
    // 2026-09-10 thirteen such rules were accepted at once, and none of them
    // took effect (Kraken stayed un-excluded), while the seven in avoidStack
    // also diluted avoidStackOverlap — it divides by the array length, so
    // padding it weakened the real Java/PHP/Ruby penalty ~2.7x.
    if (!isMechanicalFieldValueValid(proposal.campo_alvo, proposal.regra)) {
      rejected++;
      continue;
    }

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

  if (rejected > 0) {
    console.warn(`[distill] ${rejected} proposta(s) descartada(s): prosa em campo de casamento mecânico`);
  }

  return { proposalsCreated: created, proposalsRejected: rejected };
}
