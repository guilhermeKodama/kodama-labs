import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { fetchPoliticianNews } from "@/lib/news/news";
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";

const BATCH_SIZE = 20;
const POLITE_DELAY_MS = 1500;
const BUDGET_MS = 100_000;
const REFRESH_MS = 3 * 86_400_000; // re-check each politician every 3 days

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Links recent news to active politicians via the news aggregator. One
 * RawRecord per politician (externalId = politician id), refreshed every few
 * days. Best-effort: a failed query yields no articles, not a job failure.
 */
export async function ingestNews() {
  return runJob("ingest-news", "ingestion", async () => {
    const politicians = await prisma.politician.findMany({
      where: { active: true },
      select: { id: true, name: true, ballotName: true },
    });

    const existing = await prisma.rawRecord.findMany({
      where: { source: "NEWS", recordType: "news" },
      select: { externalId: true, fetchedAt: true },
    });
    const fetchedAt = new Map(existing.map((r) => [r.externalId, r.fetchedAt]));

    const now = Date.now();
    const toFetch = politicians.filter((p) => {
      const at = fetchedAt.get(p.id);
      return !at || now - at.getTime() >= REFRESH_MS;
    });
    const batch = toFetch.slice(0, BATCH_SIZE);

    console.log(
      `[ingest-news] ${politicians.length} active, ${toFetch.length} due, fetching ${batch.length}`,
    );

    let recordsOut = 0;
    const budget = new BudgetTracker(BUDGET_MS);

    for (const p of batch) {
      if (budget.exceeded()) {
        console.log(`[ingest-news] Budget exhausted; yielding`);
        break;
      }
      const query = (p.ballotName?.trim() || p.name).trim();
      const articles = await fetchPoliticianNews(query, 15);
      const data = (
        articles.length ? articles : { _empty: true }
      ) as unknown as Prisma.InputJsonValue;

      await prisma.rawRecord.upsert({
        where: {
          source_recordType_externalId: {
            source: "NEWS",
            recordType: "news",
            externalId: p.id,
          },
        },
        create: {
          source: "NEWS",
          recordType: "news",
          externalId: p.id,
          data,
        },
        update: { data, fetchedAt: new Date(), processedAt: null },
      });
      recordsOut++;
      await sleep(POLITE_DELAY_MS);
    }

    return { recordsIn: batch.length, recordsOut };
  });
}
