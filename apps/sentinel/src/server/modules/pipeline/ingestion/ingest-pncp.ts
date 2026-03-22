import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchProcurements, fetchContracts } from "@/lib/gov-apis/pncp";
import { format, subDays } from "date-fns";

export async function ingestPncp() {
  return runJob("ingest-pncp", "ingestion", async () => {
    let totalRecordsIn = 0;
    let totalRecordsOut = 0;

    const procResult = await ingestPncpProcurements();
    totalRecordsIn += procResult.recordsIn;
    totalRecordsOut += procResult.recordsOut;

    const contractResult = await ingestPncpContracts();
    totalRecordsIn += contractResult.recordsIn;
    totalRecordsOut += contractResult.recordsOut;

    return { recordsIn: totalRecordsIn, recordsOut: totalRecordsOut };
  });
}

async function ingestPncpProcurements() {
  const cursor = await getOrCreateCursor(
    "PNCP",
    "/v1/contratacoes/publicacao",
    subDays(new Date(), 7)
  );

  await updateCursor(cursor.id, { status: "RUNNING" });

  const startDate = format(cursor.lastFetchedAt, "yyyyMMdd");
  const endDate = format(new Date(), "yyyyMMdd");

  let totalIn = 0;
  let totalOut = 0;

  try {
    const response = await fetchProcurements(startDate, endDate, 1, 50);
    const records = response.data ?? [];
    totalIn = records.length;

    for (const record of records) {
      const externalId = record.numeroControlePNCP ?? 
        `${record.orgaoEntidade.cnpj}-${record.anoCompra}-${record.sequencialCompra}`;

      await prisma.rawRecord.upsert({
        where: {
          source_recordType_externalId: {
            source: "PNCP",
            recordType: "procurement",
            externalId,
          },
        },
        create: {
          source: "PNCP",
          recordType: "procurement",
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
      cursorValue: endDate,
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

async function ingestPncpContracts() {
  const cursor = await getOrCreateCursor(
    "PNCP",
    "/v1/contratos",
    subDays(new Date(), 7)
  );

  await updateCursor(cursor.id, { status: "RUNNING" });

  const startDate = format(cursor.lastFetchedAt, "yyyyMMdd");
  const endDate = format(new Date(), "yyyyMMdd");

  let totalIn = 0;
  let totalOut = 0;

  try {
    const response = await fetchContracts(startDate, endDate, 1, 50);
    const records = response.data ?? [];
    totalIn = records.length;

    for (const record of records) {
      const externalId = record.numeroControlePNCP ??
        `${record.orgaoEntidade.cnpj}-${record.anoContrato}-${record.sequencialContrato}`;

      await prisma.rawRecord.upsert({
        where: {
          source_recordType_externalId: {
            source: "PNCP",
            recordType: "contract",
            externalId,
          },
        },
        create: {
          source: "PNCP",
          recordType: "contract",
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
      cursorValue: endDate,
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
