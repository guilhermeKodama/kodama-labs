import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import {
  fetchVotacoes,
  fetchVotacaoVotos,
  fetchVotacaoOrientacoes,
} from "@/lib/gov-apis/camara";
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";

const WINDOW_DAYS = 120;
const BATCH_SIZE = 15;
const POLITE_DELAY_MS = 800;
const BUDGET_MS = 100_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Votação-centric ingestion: one fetch yields all 513 deputies' votes, far
 * cheaper than per-deputy. Stores one RawRecord per votação (votos +
 * government/party orientations). New votações in the trailing window are
 * picked up; already-stored ones are skipped (votes are final once recorded).
 */
export async function ingestVotacoes() {
  return runJob("ingest-votacoes", "ingestion", async () => {
    const now = new Date();
    const start = new Date(now.getTime() - WINDOW_DAYS * 86_400_000);
    const votacoes = await fetchVotacoes(ymd(start), ymd(now), 200);

    const existing = await prisma.rawRecord.findMany({
      where: { source: "CAMARA_LEGISLATIVE", recordType: "votacao" },
      select: { externalId: true },
    });
    const have = new Set(existing.map((r) => r.externalId));
    const pending = votacoes.filter((v) => !have.has(v.id));
    const batch = pending.slice(0, BATCH_SIZE);

    console.log(
      `[ingest-votacoes] window ${ymd(start)}..${ymd(now)}: ${votacoes.length} votações, ${pending.length} new, fetching ${batch.length}`,
    );

    let recordsOut = 0;
    const budget = new BudgetTracker(BUDGET_MS);

    for (const v of batch) {
      if (budget.exceeded()) {
        console.log(`[ingest-votacoes] Budget exhausted; yielding`);
        break;
      }
      try {
        const [votos, orientacoes] = await Promise.all([
          fetchVotacaoVotos(v.id),
          fetchVotacaoOrientacoes(v.id),
        ]);

        // Many votações are symbolic (no nominal votes) — store empty so we
        // don't re-fetch them every run.
        const data = (
          votos.length
            ? { votacao: v, votos, orientacoes }
            : { votacao: v, votos: [], orientacoes: [], _empty: true }
        ) as unknown as Prisma.InputJsonValue;

        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "CAMARA_LEGISLATIVE",
              recordType: "votacao",
              externalId: v.id,
            },
          },
          create: {
            source: "CAMARA_LEGISLATIVE",
            recordType: "votacao",
            externalId: v.id,
            data,
          },
          update: { data, fetchedAt: new Date(), processedAt: null },
        });
        recordsOut++;
      } catch (err) {
        console.warn(
          `[ingest-votacoes] Failed for votação ${v.id}:`,
          err instanceof Error ? err.message : err,
        );
      }
      await sleep(POLITE_DELAY_MS);
    }

    return { recordsIn: batch.length, recordsOut };
  });
}
