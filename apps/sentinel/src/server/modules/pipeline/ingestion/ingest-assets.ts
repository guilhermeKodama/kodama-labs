import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchTseAssets } from "@/lib/gov-apis/tse";

const ELECTION_YEARS = [2020, 2022, 2024];
const POLITE_DELAY_MS = 2000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function findCol(row: Record<string, string>, pattern: RegExp): string {
  for (const key of Object.keys(row)) {
    if (pattern.test(key)) return row[key] ?? "";
  }
  return "";
}

export async function ingestAssets() {
  return runJob("ingest-assets", "ingestion", async () => {
    let totalIn = 0;
    let totalOut = 0;

    for (let i = 0; i < ELECTION_YEARS.length; i++) {
      const result = await ingestTseAssets(ELECTION_YEARS[i]!);
      totalIn += result.recordsIn;
      totalOut += result.recordsOut;
      if (i < ELECTION_YEARS.length - 1) await sleep(POLITE_DELAY_MS);
    }

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}

async function ingestTseAssets(year: number) {
  const endpoint = `bem_candidato/${year}`;
  const cursor = await getOrCreateCursor("TSE", endpoint, new Date(0));

  const daysSinceLastFetch =
    (Date.now() - cursor.lastFetchedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastFetch < 7) {
    console.log(`[ingest-assets] TSE assets ${year} already fetched recently, skipping`);
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  let recordsIn = 0;
  let recordsOut = 0;

  try {
    const rows = await fetchTseAssets(year);
    recordsIn = rows.length;

    for (const row of rows) {
      const seq = findCol(row, /SQ_CANDIDATO/i);
      const order = findCol(row, /NR_ORDEM_CANDIDATO/i) || findCol(row, /NR_ORDEM_BEM_CANDIDATO/i);
      if (!seq) continue;

      const externalId = `${year}-${seq}-${order || recordsOut}`;

      try {
        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "TSE",
              recordType: "asset",
              externalId,
            },
          },
          create: {
            source: "TSE",
            recordType: "asset",
            externalId,
            data: { ...row, _year: year } as unknown as Prisma.InputJsonValue,
          },
          update: {
            data: { ...row, _year: year } as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
            processedAt: null,
          },
        });
        recordsOut++;
      } catch (err) {
        console.error(`[ingest-assets] Error saving asset:`, err);
      }
    }

    await updateCursor(cursor.id, {
      status: "COMPLETED",
      lastFetchedAt: new Date(),
      totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
      lastError: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ingest-assets] TSE ${year} failed:`, msg);
    await updateCursor(cursor.id, { status: "FAILED", lastError: msg });
  }

  return { recordsIn, recordsOut };
}
