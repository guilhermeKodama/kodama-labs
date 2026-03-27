import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchLicitacoes, fetchContratos } from "@/lib/gov-apis/transparencia";
import { format, subMonths, addMonths, min } from "date-fns";

const POLITE_DELAY_MS = 2000;

const FEDERAL_ORGANS = [
  "20000", // Presidência
  "22000", // Ministério da Agricultura
  "24000", // Ministério da Ciência
  "25000", // Ministério da Fazenda
  "26000", // Ministério da Educação
  "28000", // Ministério do Desenvolvimento
  "30000", // Ministério da Justiça
  "32000", // Ministério de Minas e Energia
  "33000", // Ministério da Previdência
  "35000", // Ministério das Relações Exteriores
  "36000", // Ministério da Saúde
  "39000", // Ministério dos Transportes
  "42000", // Ministério do Planejamento
  "44000", // Ministério do Meio Ambiente
  "49000", // Ministério do Desenvolvimento Agrário
  "52000", // Ministério da Defesa
  "54000", // Ministério do Turismo
  "55000", // Ministério dos Esportes
  "56000", // Ministério das Cidades
  "80000", // Ministério da Gestão
];

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ingestTransparencia() {
  return runJob("ingest-transparencia", "ingestion", async () => {
    let totalIn = 0;
    let totalOut = 0;

    try {
      const licResult = await ingestLicitacoes();
      totalIn += licResult.recordsIn;
      totalOut += licResult.recordsOut;
    } catch (e) {
      console.warn("[ingest-transparencia] Licitacoes failed, skipping:", e instanceof Error ? e.message : e);
    }

    try {
      const contResult = await ingestContratos();
      totalIn += contResult.recordsIn;
      totalOut += contResult.recordsOut;
    } catch (e) {
      console.warn("[ingest-transparencia] Contratos failed, skipping:", e instanceof Error ? e.message : e);
    }

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}

async function ingestLicitacoes() {
  // Start from 2 years back to capture historical data available in the API
  const defaultStart = subMonths(new Date(), 24);
  const cursor = await getOrCreateCursor(
    "TRANSPARENCIA",
    "/licitacoes",
    defaultStart
  );

  if (cursor.status === "RUNNING") {
    console.log("[ingest-transparencia] Licitacoes cursor is RUNNING, skipping");
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  // Walk forward in 1-month windows from last fetched date
  let windowStart = cursor.lastFetchedAt < defaultStart ? defaultStart : cursor.lastFetchedAt;
  const today = new Date();

  let totalIn = 0;
  let totalOut = 0;

  try {
    while (windowStart < today) {
      const windowEnd = min([addMonths(windowStart, 1), today]);
      const startDate = format(windowStart, "dd/MM/yyyy");
      const endDate = format(windowEnd, "dd/MM/yyyy");

      console.log(`[ingest-transparencia] Licitacoes window ${startDate} → ${endDate}`);

      for (const orgCode of FEDERAL_ORGANS) {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          try {
            const records = await fetchLicitacoes(startDate, endDate, page, 100, orgCode);
            if (records.length > 0) {
              console.log(`[ingest-transparencia] Licitacoes org=${orgCode} p=${page}: ${records.length} records`);
            }
            totalIn += records.length;

            for (const record of records) {
              const externalId = `transparencia-lic-${record.id}`;
              await prisma.rawRecord.upsert({
                where: {
                  source_recordType_externalId: {
                    source: "TRANSPARENCIA",
                    recordType: "licitacao",
                    externalId,
                  },
                },
                create: {
                  source: "TRANSPARENCIA",
                  recordType: "licitacao",
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
          } catch (err) {
            console.warn(`[ingest-transparencia] Licitacoes org=${orgCode} p=${page} error:`, err instanceof Error ? err.message : err);
            hasMore = false;
          }
          if (hasMore) await sleep(POLITE_DELAY_MS);
        }
        await sleep(POLITE_DELAY_MS);
      }

      console.log(`[ingest-transparencia] Licitacoes window done: ${totalIn} fetched so far`);

      await updateCursor(cursor.id, {
        lastFetchedAt: windowEnd,
        cursorValue: format(windowEnd, "dd/MM/yyyy"),
        totalFetched: cursor.totalFetched + totalOut,
      });

      windowStart = windowEnd;
    }

    console.log(`[ingest-transparencia] Licitacoes complete: ${totalIn} fetched, ${totalOut} saved`);
    await updateCursor(cursor.id, { status: "IDLE", lastError: null });
  } catch (error) {
    await updateCursor(cursor.id, {
      status: "FAILED",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }

  return { recordsIn: totalIn, recordsOut: totalOut };
}

async function ingestContratos() {
  const defaultStart = subMonths(new Date(), 24);
  const cursor = await getOrCreateCursor(
    "TRANSPARENCIA",
    "/contratos",
    defaultStart
  );

  if (cursor.status === "RUNNING") {
    console.log("[ingest-transparencia] Contratos cursor is RUNNING, skipping");
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  let windowStart = cursor.lastFetchedAt < defaultStart ? defaultStart : cursor.lastFetchedAt;
  const today = new Date();

  let totalIn = 0;
  let totalOut = 0;

  try {
    while (windowStart < today) {
      const windowEnd = min([addMonths(windowStart, 1), today]);
      const startDate = format(windowStart, "dd/MM/yyyy");
      const endDate = format(windowEnd, "dd/MM/yyyy");

      console.log(`[ingest-transparencia] Contratos window ${startDate} → ${endDate}`);

      for (const orgCode of FEDERAL_ORGANS) {
        let page = 1;
        let hasMore = true;

        while (hasMore) {
          try {
            const records = await fetchContratos(startDate, endDate, page, 100, orgCode);
            if (records.length > 0) {
              console.log(`[ingest-transparencia] Contratos org=${orgCode} p=${page}: ${records.length} records`);
            }
            totalIn += records.length;

            for (const record of records) {
              const externalId = `transparencia-contrato-${record.id}`;
              await prisma.rawRecord.upsert({
                where: {
                  source_recordType_externalId: {
                    source: "TRANSPARENCIA",
                    recordType: "contrato",
                    externalId,
                  },
                },
                create: {
                  source: "TRANSPARENCIA",
                  recordType: "contrato",
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
          } catch (err) {
            console.warn(`[ingest-transparencia] Contratos org=${orgCode} p=${page} error:`, err instanceof Error ? err.message : err);
            hasMore = false;
          }
          if (hasMore) await sleep(POLITE_DELAY_MS);
        }
        await sleep(POLITE_DELAY_MS);
      }

      console.log(`[ingest-transparencia] Contratos window done: ${totalIn} fetched so far`);

      await updateCursor(cursor.id, {
        lastFetchedAt: windowEnd,
        cursorValue: format(windowEnd, "dd/MM/yyyy"),
        totalFetched: cursor.totalFetched + totalOut,
      });

      windowStart = windowEnd;
    }

    console.log(`[ingest-transparencia] Contratos complete: ${totalIn} fetched, ${totalOut} saved`);
    await updateCursor(cursor.id, { status: "IDLE", lastError: null });
  } catch (error) {
    await updateCursor(cursor.id, {
      status: "FAILED",
      lastError: error instanceof Error ? error.message : "Unknown error",
    });
    throw error;
  }

  return { recordsIn: totalIn, recordsOut: totalOut };
}
