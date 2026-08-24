import { claim, complete, fail } from "../server/jobs/queue";
import { handleFetchSource } from "../server/jobs/handlers";

const TICK_MS = 5_000;

// Isolated from worker/jobs.ts on purpose: this process claims ONLY
// fetch-source tasks. FOR UPDATE SKIP LOCKED plus disjoint type sets means
// the two workers never block each other — a hung fetch against a slow or
// misbehaving board (LinkedIn, an ATS mid-outage) can never starve scoring
// or normalization, which live in the other process.
async function processFetchSource(): Promise<void> {
  const tasks = await claim(["fetch-source"], 1);
  for (const task of tasks) {
    try {
      await handleFetchSource(task.payload as { runId: string; sourceKey: string; boardId?: string });
      await complete(task.id);
    } catch (error) {
      console.error(`[sources] fetch-source (${task.id}) falhou`, error);
      await fail(task.id, error, task.attempts, task.maxAttempts);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loop(): Promise<void> {
  for (;;) {
    const start = Date.now();
    try {
      await processFetchSource();
    } catch (error) {
      console.error("[sources] falha ao processar fetch-source", error);
    }
    await sleep(Math.max(0, TICK_MS - (Date.now() - start)));
  }
}

loop();
