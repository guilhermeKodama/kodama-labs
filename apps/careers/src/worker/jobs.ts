import { claim, complete, fail, enqueue } from "../server/jobs/queue";
import {
  handleDiscover,
  handleNormalize,
  handleScore,
  handleRescoreAll,
  handleImportVault,
  handleTrainModel,
  handleDistillRules,
  handleGenerateDoc,
  ensureSourcesSeeded,
} from "../server/jobs/handlers";
import { spTodayStart } from "../server/lib/timezone";
import { prisma } from "../server/lib/prisma";

const TICK_MS = 5_000;

// Idempotent via uniqueKey `discover:${date}` — safe to check every tick.
// Only fires once the profile + sources exist (ensureSourcesSeeded ran at
// boot), and createMany's skipDuplicates means a tick that fires after
// today's discover task is already queued is a silent no-op.
async function scheduleDailyDiscover(): Promise<void> {
  const today = spTodayStart().toISOString().slice(0, 10);
  try {
    await enqueue("discover", {}, { uniqueKey: `discover:${today}` });
  } catch (error) {
    console.error("[jobs] falha ao agendar discover diário", error);
  }
}

const MIN_NEW_DECISIONS_TO_RETRAIN = 10;

// Same idempotent-per-day pattern as scheduleDailyDiscover. Retrains only
// when there's enough new signal to matter — trainScoringModel() itself
// also enforces the 10-decision floor, this just avoids enqueuing (and
// logging) a task that would immediately no-op most days.
async function scheduleTrainingIfNeeded(): Promise<void> {
  try {
    const lastModel = await prisma.scoringModel.findFirst({ orderBy: { trainedAt: "desc" } });
    const newDecisions = await prisma.triageDecision.count({
      where: lastModel ? { decidedAt: { gt: lastModel.trainedAt } } : {},
    });
    if (newDecisions < MIN_NEW_DECISIONS_TO_RETRAIN) return;

    const today = spTodayStart().toISOString().slice(0, 10);
    await enqueue("train-model", {}, { uniqueKey: `train-model:auto:${today}` });
  } catch (error) {
    console.error("[jobs] falha ao agendar retreino do modelo", error);
  }
}

// Deliberately excludes "fetch-source" — that type is claimed ONLY by
// worker:sources (see src/worker/sources.ts). This is the isolation the
// two-worker split exists for: network I/O against a slow or hostile board
// must never share a claim pool with LLM/CPU work, or a hung fetch starves
// scoring exactly as badly as if there were only one worker at all.
async function processTasks(): Promise<void> {
  const tasks = await claim(
    ["discover", "normalize", "score", "generate-doc", "rescore-all", "import-vault", "train-model", "distill-rules"],
    3
  );
  for (const task of tasks) {
    try {
      switch (task.type) {
        case "discover":
          await handleDiscover();
          break;
        case "normalize":
          await handleNormalize(task.payload as { rawPostingId: string });
          break;
        case "score":
          await handleScore(task.payload as { jobId: string });
          break;
        case "generate-doc":
          await handleGenerateDoc(task.payload as { jobId: string; kind: "TAILORED_RESUME" | "COVER_LETTER" });
          break;
        case "rescore-all":
          await handleRescoreAll();
          break;
        case "import-vault":
          await handleImportVault(task.payload as { vaultDir?: string; dryRun?: boolean });
          break;
        case "train-model":
          await handleTrainModel();
          break;
        case "distill-rules":
          await handleDistillRules();
          break;
        default:
          console.warn(`[jobs] tipo de task desconhecido: ${task.type}`);
      }
      await complete(task.id);
    } catch (error) {
      console.error(`[jobs] task ${task.type} (${task.id}) falhou`, error);
      await fail(task.id, error, task.attempts, task.maxAttempts);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Self-scheduling loop, not setInterval — same reasoning as
// apps/attention/src/worker/jobs.ts: score/generate-doc calls routinely
// take several seconds (an LLM round trip), far past TICK_MS, and
// setInterval would fire the next tick anyway, running claim()/
// processTasks() concurrently. Awaiting each iteration fully before
// scheduling the next guarantees only one batch is ever in flight.
async function loop(): Promise<void> {
  for (;;) {
    const start = Date.now();
    try {
      await scheduleDailyDiscover();
    } catch (error) {
      console.error("[jobs] falha no agendador diário", error);
    }
    try {
      await scheduleTrainingIfNeeded();
    } catch (error) {
      console.error("[jobs] falha no agendador de retreino", error);
    }
    try {
      await processTasks();
    } catch (error) {
      console.error("[jobs] falha ao processar tasks", error);
    }
    await sleep(Math.max(0, TICK_MS - (Date.now() - start)));
  }
}

ensureSourcesSeeded()
  .catch((err) => console.error("[jobs] falha ao semear fontes", err))
  .finally(() => loop());
