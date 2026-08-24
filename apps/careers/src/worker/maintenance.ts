import { prisma } from "../server/lib/prisma";
import { requeueZombies } from "../server/jobs/queue";

const INTERVAL_MS = 60 * 60 * 1000;
const SIGHTING_STALE_DAYS = 3;
const FILTERED_POSTING_RETENTION_DAYS = 60;

/**
 * A sighting whose source has re-fetched successfully since this sighting
 * was last seen — and didn't renew it — means the posting is gone from
 * that board. Once every sighting for a Job is closed, the Job itself is
 * closed. This is best-effort (a board that silently drops a posting for a
 * day and re-adds it produces a brief false-close), not a hard guarantee.
 */
async function closeStaleJobs(): Promise<number> {
  const cutoff = new Date(Date.now() - SIGHTING_STALE_DAYS * 24 * 60 * 60 * 1000);

  const staleSightings = await prisma.jobSighting.findMany({
    where: { closedAt: null, lastSeenAt: { lt: cutoff } },
    include: { source: true },
  });

  let closedSightings = 0;
  for (const sighting of staleSightings) {
    // Only close if the source has a confirmed successful re-fetch AFTER
    // this sighting stopped being renewed — otherwise "stale" could just
    // mean the source itself has been failing (attention's own lesson:
    // don't confuse "we stopped seeing it" with "it stopped existing").
    if (!sighting.source.lastOkAt || sighting.source.lastOkAt <= sighting.lastSeenAt) continue;

    await prisma.jobSighting.update({ where: { id: sighting.id }, data: { closedAt: new Date() } });
    closedSightings++;
  }

  const candidateJobs = await prisma.job.findMany({
    where: { closedAt: null, sightings: { some: {} } },
    select: { id: true, sightings: { select: { closedAt: true } } },
  });

  let closedJobs = 0;
  for (const job of candidateJobs) {
    if (job.sightings.length > 0 && job.sightings.every((s) => s.closedAt !== null)) {
      await prisma.job.update({ where: { id: job.id }, data: { closedAt: new Date() } });
      closedJobs++;
    }
  }

  if (closedSightings > 0) console.log(`[maintenance] ${closedSightings} sighting(s) fechada(s), ${closedJobs} vaga(s) fechada(s)`);
  return closedJobs;
}

async function pruneFilteredPostings(): Promise<number> {
  const cutoff = new Date(Date.now() - FILTERED_POSTING_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.rawPosting.deleteMany({
    where: { decision: "FILTERED_OUT", lastSeenAt: { lt: cutoff } },
  });
  return count;
}

async function tick(): Promise<void> {
  try {
    const requeued = await requeueZombies();
    if (requeued > 0) console.log(`[maintenance] ${requeued} task(s) zumbi recolocada(s) na fila`);
  } catch (error) {
    console.error("[maintenance] falha ao recolocar tasks zumbi", error);
  }

  try {
    await closeStaleJobs();
  } catch (error) {
    console.error("[maintenance] falha ao fechar vagas obsoletas", error);
  }

  try {
    const pruned = await pruneFilteredPostings();
    if (pruned > 0) console.log(`[maintenance] ${pruned} raw posting(s) descartada(s) antiga(s) removida(s)`);
  } catch (error) {
    console.error("[maintenance] falha ao podar raw postings antigas", error);
  }
}

tick();
setInterval(tick, INTERVAL_MS);
