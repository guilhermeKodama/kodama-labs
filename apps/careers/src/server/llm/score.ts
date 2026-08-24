import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { prisma } from "../lib/prisma";
import { env } from "../../env";
import { parseJson } from "./anthropic";
import type { Job, Company, SearchProfile } from "../../generated/prisma";
import crypto from "node:crypto";

export const PROMPT_VERSION = "score-v1";

export const ScoreSchema = z.object({
  interesse: z.number().int().min(1).max(5),
  veredito: z.enum(["avancar", "revisar", "descartar"]),
  por_que_casa: z.string(),
  red_flags: z.string(),
  a_confirmar: z.string(),
  senioridade: z.enum(["junior", "mid", "senior", "staff", "senior_staff", "principal", "unknown"]),
  contrata_brasil: z.enum(["sim", "provavel_sim", "a_confirmar", "provavel_nao", "nao"]),
  contrata_brasil_nota: z.string(),
  equity: z.enum(["sim", "provavel_sim", "a_confirmar", "provavel_nao", "nao"]),
  equity_nota: z.string(),
  moeda: z.string().nullable(),
  people_management: z.boolean(),
  constroi_vs_opera: z.enum(["constroi", "meio_termo", "opera", "indeterminado"]),
  sinais: z.array(
    z.enum(["yc", "core_infra", "compiled_lang", "avoid_stack", "equity_forte", "salario_declarado_baixo"])
  ),
});
export type ScoreOutput = z.infer<typeof ScoreSchema>;

const SENIORITY_MAP: Record<
  ScoreOutput["senioridade"],
  "JUNIOR" | "MID" | "SENIOR" | "STAFF" | "SENIOR_STAFF" | "PRINCIPAL" | "UNKNOWN"
> = {
  junior: "JUNIOR",
  mid: "MID",
  senior: "SENIOR",
  staff: "STAFF",
  senior_staff: "SENIOR_STAFF",
  principal: "PRINCIPAL",
  unknown: "UNKNOWN",
};
const TRISTATE_MAP: Record<string, "SIM" | "PROVAVEL_SIM" | "A_CONFIRMAR" | "PROVAVEL_NAO" | "NAO"> = {
  sim: "SIM",
  provavel_sim: "PROVAVEL_SIM",
  a_confirmar: "A_CONFIRMAR",
  provavel_nao: "PROVAVEL_NAO",
  nao: "NAO",
};
const BUILD_VS_OPERATE_MAP: Record<
  ScoreOutput["constroi_vs_opera"],
  "CONSTROI" | "MEIO_TERMO" | "OPERA" | "INDETERMINADO"
> = {
  constroi: "CONSTROI",
  meio_termo: "MEIO_TERMO",
  opera: "OPERA",
  indeterminado: "INDETERMINADO",
};

const RUBRIC_LINES = [
  "Voce e um assistente que avalia vagas de emprego contra o perfil de busca de um engenheiro de software senior.",
  "Responda SEMPRE em portugues do Brasil.",
  'De uma nota de 1 a 5 ("interesse"), onde 5 = aplicar imediatamente e 1 = irrelevante.',
  'O veredito "descartar" deve ser usado com moderacao, so quando a vaga claramente nao serve.',
  "Preencha por_que_casa, red_flags e a_confirmar como paragrafos curtos e diretos, no mesmo estilo de anotacao pessoal (nao formal).",
  "O campo mais importante e constroi_vs_opera: o teste NAO e papel interno vs voltado ao produto,",
  "e sim se o dia a dia e CONSTRUIR sistemas core/plataforma (mesmo sem usuario final na frente) ou",
  "OPERAR/destravar o que os outros constroem (observability, release engineering, DevEx, SRE primario).",
  "Marque people_management como true para qualquer vaga de gestao de pessoas (performance review, compensacao, 1:1s)",
  "- isso e regra dura e o codigo descarta automaticamente quando true, independente da nota.",
];
const RUBRIC_INSTRUCTIONS = RUBRIC_LINES.join(" ");

function renderProfileBlock(profile: SearchProfile): string {
  const lines = [
    `PERFIL DE BUSCA (v${profile.version})`,
    `Trilha: ${profile.track} | Papel: ${profile.builderOrOperator} | Senioridade minima: ${profile.minSeniority}`,
    `Cargos-alvo: ${profile.targetTitles.join(", ") || "-"}`,
    `Stack principal: ${profile.coreStack.join(", ") || "-"}`,
    `Dominios: ${profile.domains.join(", ") || "-"}`,
    `Piso salarial anual (USD, so descarta se declarado abaixo): ${profile.salaryFloorUsdAnnual}`,
    `Alvo salarial anual (USD): ${profile.salaryTargetUsdAnnual}`,
    `Quer equity: ${profile.wantsEquity ? "sim" : "nao"} (peso: ${profile.equityWeight})`,
    `Empresas de referencia: ${profile.referenceCompanies.join(", ") || "-"}`,
    `Setores preferidos: ${profile.preferredSectors.join(", ") || "-"}`,
    `Priorizar YC: ${profile.prioritizeYc ? "sim" : "nao"} | Bonus empresa core-infra: ${profile.bonusCoreInfra ? "sim" : "nao"}`,
    `Stack desejada (aprender/usar mais): ${profile.desiredStack.join(", ") || "-"}`,
    `Stack a evitar no core: ${profile.avoidStack.join(", ") || "-"}`,
    `Tamanho de empresa aceito: ${profile.companySizes.join(", ") || "-"}`,
    `Fuso base: ${profile.timezoneBase}, overlap minimo: ${profile.minOverlapHours}h`,
    "",
    "QUERO FAZER (o papel buscado):",
    ...(profile.wantToDo.length ? profile.wantToDo.map((l) => `- ${l}`) : ["- -"]),
    "",
    "NAO QUERO (red flags fortes):",
    ...(profile.doNotWant.length ? profile.doNotWant.map((l) => `- ${l}`) : ["- -"]),
    "",
    "CULTURA DESEJADA:",
    ...(profile.desiredCulture.length ? profile.desiredCulture.map((l) => `- ${l}`) : ["- -"]),
  ];
  return lines.join("\n");
}

/**
 * Calibration examples mined from the vault import: extreme scores (5s and
 * 1-2s) plus every job with a user-written rejectionReason - those
 * hand-written rejections are the highest-signal training data available,
 * literally the user's own words about what he doesn't want.
 */
async function buildCalibrationBlock(): Promise<string> {
  const [topRated, bottomRated, withReasons] = await Promise.all([
    prisma.job.findMany({
      where: { interest: 5 },
      include: { company: true },
      orderBy: { createdAt: "desc" },
      take: 2,
    }),
    prisma.job.findMany({
      where: { interest: { lte: 2 }, rejectionReason: null },
      include: { company: true },
      orderBy: { createdAt: "desc" },
      take: 2,
    }),
    prisma.job.findMany({
      where: { rejectionReason: { not: null } },
      include: { company: true },
      orderBy: { createdAt: "desc" },
      take: 4,
    }),
  ]);

  const format = (j: Job & { company: Company }, extra?: string) =>
    `- ${j.company.name} - "${j.title}" - interesse ${j.interest}${extra ? ` - ${extra}` : ""}`;

  const lines = [
    ...topRated.map((j) => format(j)),
    ...bottomRated.map((j) => format(j)),
    ...withReasons.map((j) => format(j, `motivo do usuario: "${j.rejectionReason}"`)),
  ];

  if (lines.length === 0) {
    return "Nenhum exemplo de calibracao disponivel ainda - use apenas o perfil e a rubrica acima.";
  }

  return [
    "EXEMPLOS DE CALIBRACAO (decisoes reais do usuario - aprenda o padrao, especialmente nos motivos de rejeicao):",
    ...lines,
  ].join("\n");
}

function rubricHash(parts: string[]): string {
  return crypto.createHash("sha256").update(parts.join(" ")).digest("hex");
}

export async function scoreJob(jobId: string): Promise<{ scoreId: string; deferred: boolean }> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId }, include: { company: true } });
  const profile = await prisma.searchProfile.findFirst({ where: { isActive: true }, orderBy: { version: "desc" } });
  if (!profile) throw new Error("Nenhum SearchProfile ativo.");
  const resume = await prisma.resumeVersion.findFirst({ where: { isDefault: true } });

  const blockA = RUBRIC_INSTRUCTIONS;
  const blockB = renderProfileBlock(profile);
  const blockC = resume?.contentText?.trim() || "Nenhum curriculo cadastrado ainda.";
  const blockD = await buildCalibrationBlock();

  const hash = rubricHash([blockA, blockB, blockC, blockD, PROMPT_VERSION, env.SCORE_MODEL]);

  const existing = await prisma.jobScore.findUnique({
    where: { jobId_rubricHash: { jobId: job.id, rubricHash: hash } },
  });
  if (existing) {
    if (job.latestScoreId !== existing.id) {
      await applyScoreToJob(job.id, existing.id, {
        interest: existing.interest,
        peopleManagement: existing.peopleManagement ?? false,
        buildVsOperate: existing.buildVsOperate,
      });
    }
    return { scoreId: existing.id, deferred: false };
  }

  const userBlock = [
    `EMPRESA: ${job.company.name}`,
    `Saude: ${job.company.health} | Estagio: ${job.company.stage ?? "desconhecido"} | Favorita: ${job.company.isFavorite ? "sim" : "nao"}`,
    "",
    `VAGA: ${job.title}`,
    `Localizacao: ${job.locationRaw ?? "nao informada"}`,
    `Compensacao (texto original): ${job.salaryRaw ?? "nao declarada"}`,
    `Fonte: ${job.canonicalUrl ?? "-"}`,
    "",
    "DESCRICAO:",
    (job.sector ?? "").slice(0, 200),
  ].join("\n");

  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: blockA },
    { type: "text", text: blockB },
    { type: "text", text: blockC },
    // The 1h TTL matters here: the job queue's own backoff routinely
    // exceeds the 5-minute default, and this block is only regenerated
    // once a day - a 1h cache easily outlives the gap between runs.
    { type: "text", text: blockD, cache_control: { type: "ephemeral", ttl: "1h" } },
  ];

  const result = await parseJson({
    model: env.SCORE_MODEL,
    systemBlocks,
    user: userBlock,
    schema: ScoreSchema,
    maxTokens: 1200,
  });

  const llmCall = await prisma.llmCall.create({
    data: {
      purpose: "score",
      model: env.SCORE_MODEL,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      cacheCreationInputTokens: result.cacheCreationInputTokens,
      cacheReadInputTokens: result.cacheReadInputTokens,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
      jobId: job.id,
      rubricHash: hash,
    },
  });

  if (result.cacheReadInputTokens === 0 && result.cacheCreationInputTokens === 0) {
    console.warn(
      `[score] cache miss on job ${job.id} - prefix may be under Haiku's 4096-token minimum. Investigate before this becomes routine.`
    );
  }

  const out = result.data;
  // Code overrides the model on the one hard rule, same discipline as
  // apps/attention's triage normalize(): people_management=true forces a
  // discard regardless of what interest the model returned.
  const finalVerdict = out.people_management ? "descartar" : out.veredito;
  const finalInterest = out.people_management ? Math.min(out.interesse, 2) : out.interesse;

  const score = await prisma.jobScore.create({
    data: {
      jobId: job.id,
      profileVersionId: profile.id,
      resumeVersionId: resume?.id,
      model: env.SCORE_MODEL,
      promptVersion: PROMPT_VERSION,
      rubricHash: hash,
      interest: finalInterest,
      verdict: finalVerdict,
      fitWhy: out.por_que_casa,
      fitRedFlags: out.red_flags,
      fitToConfirm: out.a_confirmar,
      peopleManagement: out.people_management,
      buildVsOperate: BUILD_VS_OPERATE_MAP[out.constroi_vs_opera],
      signals: out.sinais,
      llmCallId: llmCall.id,
    },
  });

  await prisma.job.update({
    where: { id: job.id },
    data: {
      seniority: SENIORITY_MAP[out.senioridade],
      hiresBrazil: TRISTATE_MAP[out.contrata_brasil] ?? "A_CONFIRMAR",
      hiresBrazilNote: out.contrata_brasil_nota,
      equity: TRISTATE_MAP[out.equity] ?? "A_CONFIRMAR",
      equityNote: out.equity_nota,
      currency: out.moeda,
    },
  });

  await applyScoreToJob(job.id, score.id, {
    interest: finalInterest,
    peopleManagement: out.people_management,
    buildVsOperate: BUILD_VS_OPERATE_MAP[out.constroi_vs_opera],
  });

  // A hard people-management veto also flips status straight to DESCARTADA
  // - the same override the attention triage pipeline applies at the
  // code layer rather than trusting the prompt to always get it right.
  if (out.people_management) {
    await prisma.job.update({ where: { id: job.id }, data: { status: "DESCARTADA", rejectedAt: new Date() } });
    await prisma.jobStatusChange.create({
      data: {
        jobId: job.id,
        fromStatus: job.status,
        toStatus: "DESCARTADA",
        actor: "agent",
        reason: "people management (veto duro)",
      },
    });
  }

  return { scoreId: score.id, deferred: false };
}

async function applyScoreToJob(
  jobId: string,
  scoreId: string,
  fields: {
    interest: number;
    peopleManagement: boolean;
    buildVsOperate: "CONSTROI" | "MEIO_TERMO" | "OPERA" | "INDETERMINADO";
  }
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: {
      latestScoreId: scoreId,
      interest: fields.interest,
      interestSource: "AGENT",
      compatibilityScore: fields.interest * 20,
      scoreSource: "LLM",
      peopleManagement: fields.peopleManagement,
      buildVsOperate: fields.buildVsOperate,
    },
  });
}
