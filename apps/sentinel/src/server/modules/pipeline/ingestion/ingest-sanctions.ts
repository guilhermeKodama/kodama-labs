import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchCeis, fetchCnep } from "@/lib/gov-apis/transparencia";
import { fetchInidoneos, fetchInabilitados } from "@/lib/gov-apis/tcu";

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
      const tcuResult = await ingestTcuInidoneos();
      totalIn += tcuResult.recordsIn;
      totalOut += tcuResult.recordsOut;
    } catch (e) {
      console.warn("[ingest-sanctions] TCU inidoneos failed, skipping:", e instanceof Error ? e.message : e);
    }

    try {
      const tcuInabResult = await ingestTcuInabilitados();
      totalIn += tcuInabResult.recordsIn;
      totalOut += tcuInabResult.recordsOut;
    } catch (e) {
      console.warn("[ingest-sanctions] TCU inabilitados failed, skipping:", e instanceof Error ? e.message : e);
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
      if (hasMore) await sleep(POLITE_DELAY_MS);
    }

    console.log(`[ingest-sanctions] CEIS: ${totalIn} fetched, ${totalOut} saved across ${page - 1} pages`);

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
      if (hasMore) await sleep(POLITE_DELAY_MS);
    }

    console.log(`[ingest-sanctions] CNEP: ${totalIn} fetched, ${totalOut} saved across ${page - 1} pages`);

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

async function ingestTcuInidoneos() {
  const cursor = await getOrCreateCursor("TCU", "/dados-abertos/inidoneos");
  await updateCursor(cursor.id, { status: "RUNNING" });

  try {
    const inidoneos = await fetchInidoneos();
    let totalOut = 0;

    for (const record of inidoneos) {
      if (!record.cpfCnpj || !record.processo) continue;
      const externalId = `tcu-inidoneo-${record.cpfCnpj}-${record.processo}`;

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
          data: { ...record, _tcuType: "inidoneo" } as unknown as Prisma.InputJsonValue,
        },
        update: {
          data: { ...record, _tcuType: "inidoneo" } as unknown as Prisma.InputJsonValue,
          fetchedAt: new Date(),
          processedAt: null,
        },
      });
      totalOut++;
    }

    console.log(`[ingest-sanctions] TCU inidoneos: ${inidoneos.length} fetched, ${totalOut} saved`);

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

async function ingestTcuInabilitados() {
  const cursor = await getOrCreateCursor("TCU", "/dados-abertos/inabilitados");
  await updateCursor(cursor.id, { status: "RUNNING" });

  try {
    const inabilitados = await fetchInabilitados();
    let totalOut = 0;

    for (const record of inabilitados) {
      if (!record.cpfCnpj || !record.processo) continue;
      const externalId = `tcu-inabilitado-${record.cpfCnpj}-${record.processo}`;

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
          data: { ...record, _tcuType: "inabilitado" } as unknown as Prisma.InputJsonValue,
        },
        update: {
          data: { ...record, _tcuType: "inabilitado" } as unknown as Prisma.InputJsonValue,
          fetchedAt: new Date(),
          processedAt: null,
        },
      });
      totalOut++;
    }

    console.log(`[ingest-sanctions] TCU inabilitados: ${inabilitados.length} fetched, ${totalOut} saved`);

    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      totalFetched: cursor.totalFetched + totalOut,
      status: "IDLE",
      lastError: null,
    });

    return { recordsIn: inabilitados.length, recordsOut: totalOut };
  } catch (error) {
    await updateCursor(cursor.id, {
      status: "FAILED",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }
}
