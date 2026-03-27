import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchProcurements, fetchContractsPage } from "@/lib/gov-apis/pncp";
import { format, subDays } from "date-fns";

export async function ingestPncp() {
  return runJob("ingest-pncp", "ingestion", async () => {
    return ingestPncpProcurements();
  });
}

export async function ingestPncpContratos() {
  return runJob("ingest-pncp-contracts", "ingestion", async () => {
    return ingestPncpContracts();
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
    console.log(`[ingest-pncp] Fetching procurements from ${startDate} to ${endDate} (all pages)`);
    const response = await fetchProcurements(startDate, endDate, 1, 50);
    const records = response.data ?? [];
    totalIn = records.length;
    console.log(`[ingest-pncp] Fetched ${totalIn} procurement records across all pages`);

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

  const PAGE_SIZE = 50;
  const startStr = format(cursor.lastFetchedAt, "yyyyMMdd");
  const endStr = format(new Date(), "yyyyMMdd");

  // Resume from last saved page (stored in cursorValue as "YYYYMMDD:page")
  let currentPage = 1;
  const cursorMeta = cursor.cursorValue ?? "";
  if (cursorMeta.includes(":")) {
    const [savedDate, savedPage] = cursorMeta.split(":");
    if (savedDate === startStr) {
      currentPage = parseInt(savedPage ?? "1") || 1;
    }
  }

  let totalIn = 0;
  let totalOut = 0;

  try {
    console.log(`[ingest-pncp] Fetching contracts ${startStr}→${endStr} starting page ${currentPage}`);

    let hasMore = true;
    while (hasMore) {
      const response = await fetchContractsPage(startStr, endStr, currentPage, PAGE_SIZE);
      const records = response.data ?? [];
      totalIn += records.length;

      if (records.length > 0) {
        console.log(`[ingest-pncp] Contracts p${currentPage}: ${records.length} records (total pages: ${response.totalPaginas})`);
      }

      for (const record of records) {
        const externalId =
          record.numeroControlePNCP ??
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

      // Save progress after each page for crash recovery
      await updateCursor(cursor.id, {
        cursorValue: `${startStr}:${currentPage + 1}`,
        totalFetched: cursor.totalFetched + totalOut,
      });

      hasMore = records.length >= PAGE_SIZE;
      if (hasMore) currentPage++;
    }

    // All pages done — advance the cursor forward
    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      cursorValue: endStr,
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
