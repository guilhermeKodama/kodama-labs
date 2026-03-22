import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchCeis, fetchCnep } from "@/lib/gov-apis/transparencia";
import { fetchInidoneos } from "@/lib/gov-apis/tcu";

const POLITE_DELAY_MS = 1500;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ingestSanctions() {
  return runJob("ingest-sanctions", "ingestion", async () => {
    let totalIn = 0;
    let totalOut = 0;

    try {
      const ceisResult = await ingestCeisSanctions();
      totalIn += ceisResult.recordsIn;
      totalOut += ceisResult.recordsOut;
    } catch (e) {
      console.warn("[ingest-sanctions] CEIS failed, skipping:", e instanceof Error ? e.message : e);
    }

    try {
      const cnepResult = await ingestCnepSanctions();
      totalIn += cnepResult.recordsIn;
      totalOut += cnepResult.recordsOut;
    } catch (e) {
      console.warn("[ingest-sanctions] CNEP failed, skipping:", e instanceof Error ? e.message : e);
    }

    try {
      const tcuResult = await ingestTcuSanctions();
      totalIn += tcuResult.recordsIn;
      totalOut += tcuResult.recordsOut;
    } catch (e) {
      console.warn("[ingest-sanctions] TCU failed, skipping:", e instanceof Error ? e.message : e);
    }

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}

async function ingestCeisSanctions() {
  const cursor = await getOrCreateCursor("CEIS", "/ceis");
  await updateCursor(cursor.id, { status: "RUNNING" });

  let totalIn = 0;
  let totalOut = 0;
  let page = 1;
  let hasMore = true;

  try {
    while (hasMore) {
      const records = await fetchCeis(page, 100);
      totalIn += records.length;

      for (const record of records) {
        const externalId = `ceis-${record.id}`;

        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "CEIS",
              recordType: "sanction",
              externalId,
            },
          },
          create: {
            source: "CEIS",
            recordType: "sanction",
            externalId,
            data: record as unknown as Prisma.InputJsonValue,
          },
          update: {
            data: record as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
            processedAt: null,
          },
        });
        totalOut++;
      }

      hasMore = records.length === 100;
      page++;
      if (page > 50) break;
      if (hasMore) await sleep(POLITE_DELAY_MS);
    }

    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      totalFetched: cursor.totalFetched + totalOut,
      status: "IDLE",
      lastError: null,
    });
  } catch (error) {
    await updateCursor(cursor.id, {
      status: "FAILED",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }

  return { recordsIn: totalIn, recordsOut: totalOut };
}

async function ingestCnepSanctions() {
  const cursor = await getOrCreateCursor("CNEP", "/cnep");
  await updateCursor(cursor.id, { status: "RUNNING" });

  let totalIn = 0;
  let totalOut = 0;
  let page = 1;
  let hasMore = true;

  try {
    while (hasMore) {
      const records = await fetchCnep(page, 100);
      totalIn += records.length;

      for (const record of records) {
        const externalId = `cnep-${record.id}`;

        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "CNEP",
              recordType: "sanction",
              externalId,
            },
          },
          create: {
            source: "CNEP",
            recordType: "sanction",
            externalId,
            data: record as unknown as Prisma.InputJsonValue,
          },
          update: {
            data: record as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
            processedAt: null,
          },
        });
        totalOut++;
      }

      hasMore = records.length === 100;
      page++;
      if (page > 50) break;
      if (hasMore) await sleep(POLITE_DELAY_MS);
    }

    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      totalFetched: cursor.totalFetched + totalOut,
      status: "IDLE",
      lastError: null,
    });
  } catch (error) {
    await updateCursor(cursor.id, {
      status: "FAILED",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }

  return { recordsIn: totalIn, recordsOut: totalOut };
}

async function ingestTcuSanctions() {
  const cursor = await getOrCreateCursor("TCU", "/dados-abertos/inidoneos");
  await updateCursor(cursor.id, { status: "RUNNING" });

  try {
    const inidoneos = await fetchInidoneos();
    let totalOut = 0;

    for (const record of inidoneos) {
      if (!record.cpfCnpj || !record.processo) continue;
      const externalId = `tcu-${record.cpfCnpj}-${record.processo}`;

      await prisma.rawRecord.upsert({
        where: {
          source_recordType_externalId: {
            source: "TCU",
            recordType: "sanction",
            externalId,
          },
        },
        create: {
          source: "TCU",
          recordType: "sanction",
          externalId,
          data: record as unknown as Prisma.InputJsonValue,
        },
        update: {
          data: record as unknown as Prisma.InputJsonValue,
          fetchedAt: new Date(),
          processedAt: null,
        },
      });
      totalOut++;
    }

    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      totalFetched: cursor.totalFetched + totalOut,
      status: "IDLE",
      lastError: null,
    });

    return { recordsIn: inidoneos.length, recordsOut: totalOut };
  } catch (error) {
    await updateCursor(cursor.id, {
      status: "FAILED",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
