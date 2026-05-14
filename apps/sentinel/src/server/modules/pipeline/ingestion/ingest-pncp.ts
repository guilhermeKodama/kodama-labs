import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import {
  fetchProcurementsPage,
  fetchContractsPage,
  PNCP_DEFAULT_MODALITIES,
} from "@/lib/gov-apis/pncp";
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";
import { format, subDays } from "date-fns";

const PROCUREMENTS_BUDGET_MS = 120_000;
const CONTRACTS_BUDGET_MS = 120_000;
const PAGE_SIZE = 50;

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

// Cursor encoding for procurements: "YYYYMMDD:modalityIdx:page"
function parseProcurementsCursor(cursorValue: string | null | undefined, startStr: string) {
  if (!cursorValue) return { modalityIdx: 0, page: 1, sameWindow: false };
  const parts = cursorValue.split(":");
  if (parts.length !== 3) return { modalityIdx: 0, page: 1, sameWindow: false };
  const [savedDate, savedModalityIdx, savedPage] = parts;
  if (savedDate !== startStr) return { modalityIdx: 0, page: 1, sameWindow: false };
  return {
    modalityIdx: Math.max(0, parseInt(savedModalityIdx ?? "0", 10) || 0),
    page: Math.max(1, parseInt(savedPage ?? "1", 10) || 1),
    sameWindow: true,
  };
}

async function ingestPncpProcurements() {
  const cursor = await getOrCreateCursor(
    "PNCP",
    "/v1/contratacoes/publicacao",
    subDays(new Date(), 7)
  );

  await updateCursor(cursor.id, { status: "RUNNING" });

  const startStr = format(cursor.lastFetchedAt, "yyyyMMdd");
  const endStr = format(new Date(), "yyyyMMdd");
  const budget = new BudgetTracker(PROCUREMENTS_BUDGET_MS);

  const resume = parseProcurementsCursor(cursor.cursorValue, startStr);
  let modalityIdx = resume.modalityIdx;
  let page = resume.page;

  let totalIn = 0;
  let totalOut = 0;

  try {
    if (resume.sameWindow && (modalityIdx > 0 || page > 1)) {
      console.log(
        `[ingest-pncp] Procurements ${startStr}→${endStr} resume at modality[${modalityIdx}]=${PNCP_DEFAULT_MODALITIES[modalityIdx]} p${page}`,
      );
    } else {
      console.log(`[ingest-pncp] Procurements ${startStr}→${endStr} starting fresh`);
    }

    modalityLoop: for (; modalityIdx < PNCP_DEFAULT_MODALITIES.length; modalityIdx++) {
      const modality = PNCP_DEFAULT_MODALITIES[modalityIdx]!;
      let pageRecords: number;

      do {
        let records: Awaited<ReturnType<typeof fetchProcurementsPage>>["data"] = [];
        try {
          const response = await fetchProcurementsPage(startStr, endStr, modality, page, PAGE_SIZE);
          records = response.data ?? [];
        } catch (err) {
          console.warn(
            `[ingest-pncp] Procurements modality=${modality} p${page} error:`,
            err instanceof Error ? err.message : err,
          );
          records = [];
        }

        pageRecords = records.length;
        totalIn += pageRecords;

        if (pageRecords > 0) {
          console.log(`[ingest-pncp] Procurements modality=${modality} p${page}: ${pageRecords} records`);
        }

        for (const record of records) {
          const externalId =
            record.numeroControlePNCP ??
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

        page++;

        await updateCursor(cursor.id, {
          cursorValue: `${startStr}:${modalityIdx}:${page}`,
          totalFetched: cursor.totalFetched + totalOut,
        });

        if (budget.exceeded()) {
          console.log(
            `[ingest-pncp] Procurements budget exhausted at modality[${modalityIdx}]=${modality} p${page}; yielding`,
          );
          await updateCursor(cursor.id, { status: "IDLE", lastError: null });
          return { recordsIn: totalIn, recordsOut: totalOut };
        }
      } while (pageRecords >= PAGE_SIZE);

      // Modality done — advance to next modality, reset page
      page = 1;
      await updateCursor(cursor.id, {
        cursorValue: `${startStr}:${modalityIdx + 1}:1`,
        totalFetched: cursor.totalFetched + totalOut,
      });

      if (budget.exceeded()) {
        console.log(`[ingest-pncp] Procurements budget exhausted after modality[${modalityIdx}]=${modality}; yielding`);
        await updateCursor(cursor.id, { status: "IDLE", lastError: null });
        break modalityLoop;
      }
    }

    if (modalityIdx >= PNCP_DEFAULT_MODALITIES.length) {
      // All modalities for this window done — advance lastFetchedAt and reset modality cursor
      await updateCursor(cursor.id, {
        lastFetchedAt: new Date(),
        cursorValue: `${endStr}:0:1`,
        totalFetched: cursor.totalFetched + totalOut,
        status: "IDLE",
        lastError: null,
      });
      console.log(`[ingest-pncp] Procurements window ${startStr}→${endStr} complete`);
    }
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
  const cursor = await getOrCreateCursor("PNCP", "/v1/contratos", subDays(new Date(), 7));

  await updateCursor(cursor.id, { status: "RUNNING" });

  const startStr = format(cursor.lastFetchedAt, "yyyyMMdd");
  const endStr = format(new Date(), "yyyyMMdd");
  const budget = new BudgetTracker(CONTRACTS_BUDGET_MS);

  // Resume from last saved page (stored in cursorValue as "YYYYMMDD:page")
  let currentPage = 1;
  const cursorMeta = cursor.cursorValue ?? "";
  if (cursorMeta.includes(":")) {
    const [savedDate, savedPage] = cursorMeta.split(":");
    if (savedDate === startStr) {
      currentPage = Math.max(1, parseInt(savedPage ?? "1", 10) || 1);
    }
  }

  let totalIn = 0;
  let totalOut = 0;

  try {
    console.log(`[ingest-pncp] Contracts ${startStr}→${endStr} starting page ${currentPage}`);

    let hasMore = true;
    while (hasMore) {
      let records: Awaited<ReturnType<typeof fetchContractsPage>>["data"] = [];
      try {
        const response = await fetchContractsPage(startStr, endStr, currentPage, PAGE_SIZE);
        records = response.data ?? [];
      } catch (err) {
        console.warn(
          `[ingest-pncp] Contracts p${currentPage} error:`,
          err instanceof Error ? err.message : err,
        );
        records = [];
      }

      totalIn += records.length;

      if (records.length > 0) {
        console.log(`[ingest-pncp] Contracts p${currentPage}: ${records.length} records`);
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

      if (budget.exceeded()) {
        console.log(`[ingest-pncp] Contracts budget exhausted at p${currentPage}; yielding`);
        await updateCursor(cursor.id, { status: "IDLE", lastError: null });
        return { recordsIn: totalIn, recordsOut: totalOut };
      }
    }

    // All pages done — advance the cursor forward
    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      cursorValue: endStr,
      totalFetched: cursor.totalFetched + totalOut,
      status: "IDLE",
      lastError: null,
    });
    console.log(`[ingest-pncp] Contracts window ${startStr}→${endStr} complete`);
  } catch (error) {
    await updateCursor(cursor.id, {
      status: "FAILED",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }

  return { recordsIn: totalIn, recordsOut: totalOut };
}
