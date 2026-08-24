import { prisma } from "../lib/prisma";
import { enqueue } from "./queue";
import { runDiscover, finalizeIngestionRunIfDone } from "../ingest/discover";
import { runSource } from "../sources/run-source";
import { normalizeRawPosting } from "../ingest/normalize";
import { scoreJob } from "../llm/score";
import { getActiveProfile } from "../modules/search-profile";

export async function handleDiscover(): Promise<void> {
  await runDiscover("daily");
}

export async function handleFetchSource(payload: { runId: string; sourceKey: string; boardId?: string }): Promise<void> {
  const source = await prisma.source.findUnique({ where: { key: payload.sourceKey } });
  if (!source) {
    console.warn(`[jobs] fetch-source: fonte desconhecida ${payload.sourceKey}`);
    return;
  }
  const board = payload.boardId ? await prisma.companyBoard.findUnique({ where: { id: payload.boardId } }) : undefined;

  const result = await runSource({ runId: payload.runId, source, board: board ?? undefined });

  // Fan out normalize tasks for whatever this fetch staged as PENDING.
  const pending = await prisma.rawPosting.findMany({
    where: { sourceKey: payload.sourceKey, decision: "PENDING" },
    select: { id: true, contentHash: true },
    take: 500,
  });
  for (const raw of pending) {
    await enqueue("normalize", { rawPostingId: raw.id }, { uniqueKey: `normalize:${raw.id}:${raw.contentHash}` });
  }

  void result;
  await finalizeIngestionRunIfDone(payload.runId);
}

export async function handleNormalize(payload: { rawPostingId: string }): Promise<void> {
  await normalizeRawPosting(payload.rawPostingId);
}

export async function handleScore(payload: { jobId: string }): Promise<void> {
  await scoreJob(payload.jobId);
}

export async function handleRescoreAll(): Promise<void> {
  const jobs = await prisma.job.findMany({
    where: { status: { notIn: ["DESCARTADA", "CONTRATADA"] } },
    select: { id: true },
  });
  // Staggered runAt so a full re-score doesn't fire hundreds of Haiku calls
  // in the same instant and blow through the daily LLM budget in one tick.
  const now = Date.now();
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]!;
    await enqueue(
      "score",
      { jobId: job.id },
      { uniqueKey: `rescore:${job.id}:${now}`, runAt: new Date(now + i * 2000) }
    );
  }
}

export async function handleImportVault(payload: { vaultDir?: string; dryRun?: boolean }): Promise<void> {
  const { importVault } = await import("../../scripts/import-vault");
  await importVault({ vaultDir: payload.vaultDir, dryRun: payload.dryRun ?? false });
}

export async function handleTrainModel(): Promise<void> {
  const { trainScoringModel } = await import("../ml/train");
  await trainScoringModel();
}

export async function handleDistillRules(): Promise<void> {
  const { distillRules } = await import("../ml/distill");
  await distillRules();
}

export async function handleGenerateDoc(payload: { jobId: string; kind: "TAILORED_RESUME" | "COVER_LETTER" }): Promise<void> {
  const { generateSuggestions } = await import("../llm/suggest");
  await generateSuggestions(payload.jobId);
}

// Ensures a Source row exists for every registered adapter key, seeded with
// its adapter's declared defaults. Safe to call on every boot — upsert, not
// insert, so hand-edited enabled/rateLimitMs values in the DB survive.
export async function ensureSourcesSeeded(): Promise<void> {
  const { ALL_ADAPTERS } = await import("../sources/registry");
  for (const adapter of ALL_ADAPTERS) {
    await prisma.source.upsert({
      where: { key: adapter.key },
      create: {
        key: adapter.key,
        kind: adapter.kind,
        label: adapter.key,
        enabled: adapter.defaultEnabled,
        rateLimitMs: adapter.defaultRateLimitMs,
      },
      update: {},
    });
  }
  // maxJobsPerDay on Source rows isn't used directly (the cap lives on
  // SearchProfile), but touching getActiveProfile here fails loudly and
  // early if no profile exists yet, instead of failing deep inside the
  // first discover tick.
  try {
    await getActiveProfile();
  } catch {
    console.warn("[jobs] nenhum SearchProfile ativo ainda — rode o import do vault.");
  }
}
