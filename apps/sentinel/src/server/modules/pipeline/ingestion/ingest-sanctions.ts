import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchCeis, fetchCnep } from "@/lib/gov-apis/transparencia";
import { fetchInidoneos, fetchInabilitados } from "@/lib/gov-apis/tcu";
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";

const POLITE_DELAY_MS = 1500;
const TOTAL_BUDGET_MS = 120_000;
const TCU_REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
const PAGE_SIZE = 100;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ingestSanctions() {
  return runJob("ingest-sanctions", "ingestion", async () => {
    const budget = new BudgetTracker(TOTAL_BUDGET_MS);
    let totalIn = 0;
    let totalOut = 0;

    const subJobs: { name: string; fn: (b: BudgetTracker) => Promise<{ recordsIn: number; recordsOut: number }> }[] = [
      { name: "CEIS", fn: ingestCeisSanctions },
      { name: "CNEP", fn: ingestCnepSanctions },
      { name: "TCU inidoneos", fn: ingestTcuInidoneos },
      { name: "TCU inabilitados", fn: ingestTcuInabilitados },
    ];

    for (const job of subJobs) {
      if (budget.exceeded()) {
        console.log(`[ingest-sanctions] Budget exhausted before ${job.name}; deferring to next tick`);
        break;
      }
      try {
        const result = await job.fn(budget);
        totalIn += result.recordsIn;
        totalOut += result.recordsOut;
      } catch (e) {
        console.warn(`[ingest-sanctions] ${job.name} failed, skipping:`, e instanceof Error ? e.message : e);
      }
    }

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}

async function ingestCeisSanctions(budget: BudgetTracker) {
  const cursor = await getOrCreateCursor("CEIS", "/ceis");
  await updateCursor(cursor.id, { status: "RUNNING" });

  let totalIn = 0;
  let totalOut = 0;
  let page = Math.max(1, parseInt(cursor.cursorValue ?? "1", 10) || 1);

  try {
    let hasMore = true;
    while (hasMore) {
      const records = await fetchCeis(page, PAGE_SIZE);
      totalIn += records.length;

      for (const record of records) {
        const externalId = `ceis-${record.id}`;
        await prisma.rawRecord.upsert({
          where: { source_recordType_externalId: { source: "CEIS", recordType: "sanction", externalId } },
          create: { source: "CEIS", recordType: "sanction", externalId, data: record as unknown as Prisma.InputJsonValue },
          update: {
            data: record as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
            processedAt: null,
          },
        });
        totalOut++;
      }

      hasMore = records.length === PAGE_SIZE;
      const nextPage = hasMore ? page + 1 : 1;

      await updateCursor(cursor.id, {
        cursorValue: String(nextPage),
        totalFetched: cursor.totalFetched + totalOut,
      });

      if (hasMore && budget.exceeded()) {
        console.log(`[ingest-sanctions] CEIS budget exhausted at p${page}; yielding`);
        await updateCursor(cursor.id, { status: "IDLE", lastError: null });
        return { recordsIn: totalIn, recordsOut: totalOut };
      }

      page = nextPage;
      if (hasMore) await sleep(POLITE_DELAY_MS);
    }

    console.log(`[ingest-sanctions] CEIS complete: ${totalIn} fetched, ${totalOut} saved`);

    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      cursorValue: "1",
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

async function ingestCnepSanctions(budget: BudgetTracker) {
  const cursor = await getOrCreateCursor("CNEP", "/cnep");
  await updateCursor(cursor.id, { status: "RUNNING" });

  let totalIn = 0;
  let totalOut = 0;
  let page = Math.max(1, parseInt(cursor.cursorValue ?? "1", 10) || 1);

  try {
    let hasMore = true;
    while (hasMore) {
      const records = await fetchCnep(page, PAGE_SIZE);
      totalIn += records.length;

      for (const record of records) {
        const externalId = `cnep-${record.id}`;
        await prisma.rawRecord.upsert({
          where: { source_recordType_externalId: { source: "CNEP", recordType: "sanction", externalId } },
          create: { source: "CNEP", recordType: "sanction", externalId, data: record as unknown as Prisma.InputJsonValue },
          update: {
            data: record as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
            processedAt: null,
          },
        });
        totalOut++;
      }

      hasMore = records.length === PAGE_SIZE;
      const nextPage = hasMore ? page + 1 : 1;

      await updateCursor(cursor.id, {
        cursorValue: String(nextPage),
        totalFetched: cursor.totalFetched + totalOut,
      });

      if (hasMore && budget.exceeded()) {
        console.log(`[ingest-sanctions] CNEP budget exhausted at p${page}; yielding`);
        await updateCursor(cursor.id, { status: "IDLE", lastError: null });
        return { recordsIn: totalIn, recordsOut: totalOut };
      }

      page = nextPage;
      if (hasMore) await sleep(POLITE_DELAY_MS);
    }

    console.log(`[ingest-sanctions] CNEP complete: ${totalIn} fetched, ${totalOut} saved`);

    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      cursorValue: "1",
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

async function ingestTcuInidoneos(budget: BudgetTracker) {
  const cursor = await getOrCreateCursor("TCU", "/dados-abertos/inidoneos");

  const sinceLast = Date.now() - cursor.lastFetchedAt.getTime();
  if (sinceLast < TCU_REFRESH_INTERVAL_MS && (cursor.cursorValue ?? "0") === "0") {
    console.log(`[ingest-sanctions] TCU inidoneos refreshed ${Math.round(sinceLast / 60_000)}min ago; skipping`);
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  try {
    const inidoneos = await fetchInidoneos();
    const startOffset = Math.max(0, parseInt(cursor.cursorValue ?? "0", 10) || 0);

    let totalOut = 0;
    let i = startOffset;
    for (; i < inidoneos.length; i++) {
      const record = inidoneos[i]!;
      if (!record.cpfCnpj || !record.processo) continue;
      const externalId = `tcu-inidoneo-${record.cpfCnpj}-${record.processo}`;

      await prisma.rawRecord.upsert({
        where: { source_recordType_externalId: { source: "TCU", recordType: "sanction", externalId } },
        create: { source: "TCU", recordType: "sanction", externalId, data: { ...record, _tcuType: "inidoneo" } as unknown as Prisma.InputJsonValue },
        update: {
          data: { ...record, _tcuType: "inidoneo" } as unknown as Prisma.InputJsonValue,
          fetchedAt: new Date(),
          processedAt: null,
        },
      });
      totalOut++;

      if (totalOut % 50 === 0) {
        await updateCursor(cursor.id, {
          cursorValue: String(i + 1),
          totalFetched: cursor.totalFetched + totalOut,
        });
        if (budget.exceeded()) {
          console.log(`[ingest-sanctions] TCU inidoneos budget exhausted at ${i + 1}/${inidoneos.length}; yielding`);
          await updateCursor(cursor.id, { status: "IDLE", lastError: null });
          return { recordsIn: inidoneos.length, recordsOut: totalOut };
        }
      }
    }

    console.log(`[ingest-sanctions] TCU inidoneos complete: ${inidoneos.length} fetched, ${totalOut} saved`);

    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      cursorValue: "0",
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

async function ingestTcuInabilitados(budget: BudgetTracker) {
  const cursor = await getOrCreateCursor("TCU", "/dados-abertos/inabilitados");

  const sinceLast = Date.now() - cursor.lastFetchedAt.getTime();
  if (sinceLast < TCU_REFRESH_INTERVAL_MS && (cursor.cursorValue ?? "0") === "0") {
    console.log(`[ingest-sanctions] TCU inabilitados refreshed ${Math.round(sinceLast / 60_000)}min ago; skipping`);
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  try {
    const inabilitados = await fetchInabilitados();
    const startOffset = Math.max(0, parseInt(cursor.cursorValue ?? "0", 10) || 0);

    let totalOut = 0;
    let i = startOffset;
    for (; i < inabilitados.length; i++) {
      const record = inabilitados[i]!;
      if (!record.cpfCnpj || !record.processo) continue;
      const externalId = `tcu-inabilitado-${record.cpfCnpj}-${record.processo}`;

      await prisma.rawRecord.upsert({
        where: { source_recordType_externalId: { source: "TCU", recordType: "sanction", externalId } },
        create: { source: "TCU", recordType: "sanction", externalId, data: { ...record, _tcuType: "inabilitado" } as unknown as Prisma.InputJsonValue },
        update: {
          data: { ...record, _tcuType: "inabilitado" } as unknown as Prisma.InputJsonValue,
          fetchedAt: new Date(),
          processedAt: null,
        },
      });
      totalOut++;

      if (totalOut % 50 === 0) {
        await updateCursor(cursor.id, {
          cursorValue: String(i + 1),
          totalFetched: cursor.totalFetched + totalOut,
        });
        if (budget.exceeded()) {
          console.log(`[ingest-sanctions] TCU inabilitados budget exhausted at ${i + 1}/${inabilitados.length}; yielding`);
          await updateCursor(cursor.id, { status: "IDLE", lastError: null });
          return { recordsIn: inabilitados.length, recordsOut: totalOut };
        }
      }
    }

    console.log(`[ingest-sanctions] TCU inabilitados complete: ${inabilitados.length} fetched, ${totalOut} saved`);

    await updateCursor(cursor.id, {
      lastFetchedAt: new Date(),
      cursorValue: "0",
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
