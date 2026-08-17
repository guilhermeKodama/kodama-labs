import { env } from "../env";
import { claim, complete, fail, enqueue } from "../server/jobs/queue";
import { handleTriage, handleDraft, handleDigest } from "../server/jobs/handlers";
import { spWindowInstant } from "../server/lib/timezone";

const TICK_MS = 5_000;
const WINDOW_GRACE_MS = 2 * 60 * 60 * 1000;

// Idempotent via the job's uniqueKey — safe to re-check every tick. A window
// that already fired today no-ops (createMany skipDuplicates); one missed by
// more than the grace period is skipped by design (the next window picks up
// whatever accumulated — nothing in the queue is lost, just delayed).
async function scheduleDigestWindows(): Promise<void> {
  const now = new Date();
  const windows = env.DIGEST_WINDOWS.split(",")
    .map((w) => w.trim())
    .filter(Boolean);

  for (const hhmm of windows) {
    const occurrence = spWindowInstant(hhmm, now);
    const elapsed = now.getTime() - occurrence.getTime();
    if (elapsed < 0 || elapsed > WINDOW_GRACE_MS) continue;

    try {
      await enqueue(
        "digest",
        { scheduledFor: occurrence.toISOString() },
        { uniqueKey: `digest:${occurrence.toISOString()}` }
      );
    } catch (error) {
      console.error("[jobs] falha ao agendar janela de digest", error);
    }
  }
}

async function processJobs(): Promise<void> {
  const jobs = await claim(["triage", "draft", "digest"], 3);
  for (const job of jobs) {
    try {
      switch (job.type) {
        case "triage":
          await handleTriage(job.payload as { messageId: string });
          break;
        case "draft":
          await handleDraft(job.payload as { messageId: string });
          break;
        case "digest":
          await handleDigest(job.payload as { scheduledFor: string });
          break;
        default:
          console.warn(`[jobs] tipo de job desconhecido: ${job.type}`);
      }
      await complete(job.id);
    } catch (error) {
      console.error(`[jobs] job ${job.type} (${job.id}) falhou`, error);
      await fail(job.id, error, job.attempts, job.maxAttempts);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// A self-scheduling loop, not setInterval — triage calls routinely take
// 10-35s (GPU generation + grammar compilation), far past TICK_MS, and
// setInterval would fire the next tick anyway, running claim()/processJobs()
// concurrently. That's a real problem here (not just wasted work): the local
// model is one GPU with no request queue of its own, so overlapping ticks
// means overlapping chatJson() calls fighting over the same GPU. Awaiting
// each iteration fully before scheduling the next guarantees only one batch
// of jobs is ever in flight.
async function loop(): Promise<void> {
  for (;;) {
    const start = Date.now();
    try {
      await scheduleDigestWindows();
    } catch (error) {
      console.error("[jobs] falha no agendador de janelas", error);
    }
    try {
      await processJobs();
    } catch (error) {
      console.error("[jobs] falha ao processar jobs", error);
    }
    await sleep(Math.max(0, TICK_MS - (Date.now() - start)));
  }
}

loop();
