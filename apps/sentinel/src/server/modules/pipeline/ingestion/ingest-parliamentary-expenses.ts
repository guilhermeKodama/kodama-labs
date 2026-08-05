import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { fetchDeputyExpenses } from "@/lib/gov-apis/camara";
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";

const BATCH_SIZE = 12;
const POLITE_DELAY_MS = 1500;
const BUDGET_MS = 100_000;
// Past years are immutable once fetched; the current year is re-fetched weekly
// so new monthly expense documents flow in.
const REFRESH_MS = 7 * 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Ingests Câmara Cota Parlamentar (CEAP) expenses, one RawRecord per
 * (deputy, year) holding that year's expense array. Fans out over active
 * federal deputies (externalId = Câmara deputy id), budget/batch bounded like
 * ingest-servidores.
 */
export async function ingestParliamentaryExpenses() {
  return runJob("ingest-parliamentary-expenses", "ingestion", async () => {
    const currentYear = new Date().getFullYear();
    const years = [currentYear, currentYear - 1];

    const deputies = await prisma.politician.findMany({
      where: {
        active: true,
        position: "Deputado Federal",
        externalId: { not: null },
      },
      select: { externalId: true },
    });

    const existing = await prisma.rawRecord.findMany({
      where: { source: "CAMARA_LEGISLATIVE", recordType: "expense" },
      select: { externalId: true, fetchedAt: true },
    });
    const fetchedAtByKey = new Map(
      existing.map((r) => [r.externalId, r.fetchedAt]),
    );

    const now = Date.now();
    const targets: { deputyId: number; year: number; key: string }[] = [];
    for (const d of deputies) {
      const deputyId = Number(d.externalId);
      if (!Number.isFinite(deputyId)) continue;
      for (const year of years) {
        const key = `${deputyId}-${year}`;
        const at = fetchedAtByKey.get(key);
        if (at) {
          if (year < currentYear) continue; // past year already captured
          if (now - at.getTime() < REFRESH_MS) continue; // current year still fresh
        }
        targets.push({ deputyId, year, key });
      }
    }

    const batch = targets.slice(0, BATCH_SIZE);
    console.log(
      `[ingest-parliamentary-expenses] ${deputies.length} deputies, ${targets.length} pending (deputy,year), fetching ${batch.length}`,
    );

    let recordsOut = 0;
    const budget = new BudgetTracker(BUDGET_MS);

    for (const t of batch) {
      if (budget.exceeded()) {
        console.log(`[ingest-parliamentary-expenses] Budget exhausted; yielding`);
        break;
      }
      try {
        const expenses = await fetchDeputyExpenses(t.deputyId, t.year);
        const data = (
          expenses.length ? expenses : { _empty: true }
        ) as unknown as Prisma.InputJsonValue;

        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "CAMARA_LEGISLATIVE",
              recordType: "expense",
              externalId: t.key,
            },
          },
          create: {
            source: "CAMARA_LEGISLATIVE",
            recordType: "expense",
            externalId: t.key,
            data,
          },
          update: { data, fetchedAt: new Date(), processedAt: null },
        });
        recordsOut++;
      } catch (err) {
        console.warn(
          `[ingest-parliamentary-expenses] Failed for ${t.key}:`,
          err instanceof Error ? err.message : err,
        );
      }
      await sleep(POLITE_DELAY_MS);
    }

    return { recordsIn: batch.length, recordsOut };
  });
}
