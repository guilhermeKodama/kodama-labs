import { prisma } from "../lib/prisma";
import { enqueue } from "../jobs/queue";
import { spTodayStart } from "../lib/timezone";
import { getActiveProfile } from "../modules/search-profile";
import { sendPush } from "../push/send-push";

/**
 * Opens (or reuses) today's IngestionRun and fans out one fetch-source
 * task per enabled Source and per enabled CompanyBoard. Favorites get
 * runAt = now; everything else gets a small delay — this alone gives
 * watchlist companies priority over aggregators for the day's cap, without
 * needing a separate priority column read at claim time.
 */
export async function runDiscover(runType: "daily" | "deep_sweep" | "manual" = "daily"): Promise<{ runId: string }> {
  const profile = await getActiveProfile();
  const runDate = spTodayStart();

  const run = await prisma.ingestionRun.upsert({
    where: { runDate_runType: { runDate, runType } },
    create: { runDate, runType, cap: profile.maxJobsPerDay, status: "RUNNING" },
    update: { status: "RUNNING" },
  });

  const now = new Date();
  const later = new Date(now.getTime() + 60_000);

  // Company boards (watchlist favorites) — highest priority.
  const boards = await prisma.companyBoard.findMany({
    where: {
      enabled: true,
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
    include: { company: true },
  });

  for (const board of boards) {
    const sourceKey = `ats:${board.provider.toLowerCase()}`;
    await enqueue(
      "fetch-source",
      { runId: run.id, sourceKey, boardId: board.id },
      { uniqueKey: `fetch:${sourceKey}:${board.id}:${run.id}`, runAt: board.company.isFavorite ? now : later }
    );
  }

  // Non-ATS sources (aggregators, forum, scrape) — lower priority, delayed
  // so the daily cap is spent on favorites first.
  const sources = await prisma.source.findMany({
    where: {
      enabled: true,
      kind: { in: ["AGGREGATOR", "FORUM", "SCRAPE"] },
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: now } }],
    },
  });

  for (const source of sources) {
    await enqueue(
      "fetch-source",
      { runId: run.id, sourceKey: source.key },
      { uniqueKey: `fetch:${source.key}:-:${run.id}`, runAt: later }
    );
  }

  return { runId: run.id };
}

/** Closes out an IngestionRun once all of today's fetch-source tasks have finished. */
export async function finalizeIngestionRunIfDone(runId: string): Promise<void> {
  const pending = await prisma.task.count({
    where: { type: "fetch-source", status: { in: ["QUEUED", "RUNNING"] }, payload: { path: ["runId"], equals: runId } },
  });
  if (pending > 0) return;

  const runs = await prisma.sourceRun.findMany({ where: { runId } });
  const fetched = runs.reduce((sum, r) => sum + r.fetched, 0);
  const anyFailed = runs.some((r) => r.status === "FAILED");
  const anyPartial = runs.some((r) => r.status === "PARTIAL");

  const rawCounts = await prisma.rawPosting.groupBy({
    by: ["decision"],
    where: { sourceKey: { in: runs.map((r) => r.sourceKey) } },
    _count: true,
  });

  const promoted = rawCounts.find((c) => c.decision === "PROMOTED")?._count ?? 0;

  await prisma.ingestionRun.update({
    where: { id: runId },
    data: {
      status: anyFailed ? "PARTIAL" : anyPartial ? "PARTIAL" : "OK",
      finishedAt: new Date(),
      fetched,
      considered: rawCounts.reduce((s, c) => s + c._count, 0),
      duplicates: rawCounts.find((c) => c.decision === "DUPLICATE")?._count ?? 0,
      filtered: rawCounts.find((c) => c.decision === "FILTERED_OUT")?._count ?? 0,
      promoted,
      deferred: rawCounts.find((c) => c.decision === "PENDING")?._count ?? 0,
    },
  });

  if (promoted > 0) {
    await sendPush({
      kind: "digest",
      title: "Rodada concluída",
      body: `${promoted} vaga(s) nova(s) hoje, ${fetched} buscada(s) no total.`,
      url: "/",
      tag: "digest",
    }).catch((error) => console.error("[push] falha ao enviar digest", error));
  }
}
