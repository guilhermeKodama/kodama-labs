import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { fetchDeputyProposicoes } from "@/lib/gov-apis/camara";
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";

const BATCH_SIZE = 20;
const POLITE_DELAY_MS = 1000;
const BUDGET_MS = 100_000;
const REFRESH_MS = 7 * 86_400_000; // re-check each deputy weekly

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Deputy-centric ingestion of authored bills (proposições). One RawRecord per
 * deputy (externalId = Câmara deputy id), refreshed weekly.
 */
export async function ingestProposicoes() {
  return runJob("ingest-proposicoes", "ingestion", async () => {
    const deputies = await prisma.politician.findMany({
      where: {
        active: true,
        position: "Deputado Federal",
        externalId: { not: null },
      },
      select: { externalId: true },
    });

    const existing = await prisma.rawRecord.findMany({
      where: { source: "CAMARA_LEGISLATIVE", recordType: "proposicoes" },
      select: { externalId: true, fetchedAt: true },
    });
    const fetchedAt = new Map(existing.map((r) => [r.externalId, r.fetchedAt]));

    const now = Date.now();
    const toFetch = deputies.filter((d) => {
      const at = fetchedAt.get(d.externalId!);
      return !at || now - at.getTime() >= REFRESH_MS;
    });
    const batch = toFetch.slice(0, BATCH_SIZE);

    console.log(
      `[ingest-proposicoes] ${deputies.length} deputies, ${toFetch.length} due, fetching ${batch.length}`,
    );

    let recordsOut = 0;
    const budget = new BudgetTracker(BUDGET_MS);

    for (const d of batch) {
      if (budget.exceeded()) {
        console.log(`[ingest-proposicoes] Budget exhausted; yielding`);
        break;
      }
      const deputyId = Number(d.externalId);
      if (!Number.isFinite(deputyId)) continue;

      try {
        const props = await fetchDeputyProposicoes(deputyId, 100);
        const data = (
          props.length ? props : { _empty: true }
        ) as unknown as Prisma.InputJsonValue;

        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "CAMARA_LEGISLATIVE",
              recordType: "proposicoes",
              externalId: String(deputyId),
            },
          },
          create: {
            source: "CAMARA_LEGISLATIVE",
            recordType: "proposicoes",
            externalId: String(deputyId),
            data,
          },
          update: { data, fetchedAt: new Date(), processedAt: null },
        });
        recordsOut++;
      } catch (err) {
        console.warn(
          `[ingest-proposicoes] Failed for deputy ${deputyId}:`,
          err instanceof Error ? err.message : err,
        );
      }
      await sleep(POLITE_DELAY_MS);
    }

    return { recordsIn: batch.length, recordsOut };
  });
}
