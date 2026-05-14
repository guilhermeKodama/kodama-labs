import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchLicitacoes, fetchContratos } from "@/lib/gov-apis/transparencia";
import { format, subMonths, addMonths, min } from "date-fns";

const POLITE_DELAY_MS = 2000;
const PER_JOB_BUDGET_MS = 120_000;

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

// cursorValue encodes the next org index to process within the current window.
// "0" (or anything non-numeric, including legacy date strings) = start a fresh window.
function parseResumeOrgIndex(cursorValue: string | null | undefined): number {
  const n = parseInt(cursorValue ?? "0", 10);
  return Number.isFinite(n) && n >= 0 && n < FEDERAL_ORGANS.length ? n : 0;
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

  let windowStart = cursor.lastFetchedAt < defaultStart ? defaultStart : cursor.lastFetchedAt;
  let resumeOrgIndex = parseResumeOrgIndex(cursor.cursorValue);
  const today = new Date();
  const jobStart = Date.now();

  let totalIn = 0;
  let totalOut = 0;

  try {
    windowLoop: while (windowStart < today) {
      const windowEnd = min([addMonths(windowStart, 1), today]);
      const startDate = format(windowStart, "dd/MM/yyyy");
      const endDate = format(windowEnd, "dd/MM/yyyy");

      if (resumeOrgIndex > 0) {
        console.log(`[ingest-transparencia] Licitacoes window ${startDate} → ${endDate} (resume at org ${resumeOrgIndex}/${FEDERAL_ORGANS.length})`);
      } else {
        console.log(`[ingest-transparencia] Licitacoes window ${startDate} → ${endDate}`);
      }

      for (let orgIdx = resumeOrgIndex; orgIdx < FEDERAL_ORGANS.length; orgIdx++) {
        const orgCode = FEDERAL_ORGANS[orgIdx];
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

        // Save progress after each org completes so the next tick resumes at the next org.
        await updateCursor(cursor.id, {
          cursorValue: String(orgIdx + 1),
          totalFetched: cursor.totalFetched + totalOut,
        });

        if (Date.now() - jobStart > PER_JOB_BUDGET_MS) {
          console.log(`[ingest-transparencia] Licitacoes budget exhausted after org ${orgIdx + 1}/${FEDERAL_ORGANS.length} in window ${startDate} → ${endDate}; yielding`);
          await updateCursor(cursor.id, { status: "IDLE", lastError: null });
          return { recordsIn: totalIn, recordsOut: totalOut };
        }

        await sleep(POLITE_DELAY_MS);
      }

      console.log(`[ingest-transparencia] Licitacoes window done: ${totalIn} fetched so far`);

      // All orgs in this window done — advance window and reset org index.
      await updateCursor(cursor.id, {
        lastFetchedAt: windowEnd,
        cursorValue: "0",
        totalFetched: cursor.totalFetched + totalOut,
      });

      windowStart = windowEnd;
      resumeOrgIndex = 0;

      if (Date.now() - jobStart > PER_JOB_BUDGET_MS) {
        console.log(`[ingest-transparencia] Licitacoes budget exhausted after window ${startDate} → ${endDate}; yielding`);
        break windowLoop;
      }
    }

    console.log(`[ingest-transparencia] Licitacoes tick complete: ${totalIn} fetched, ${totalOut} saved`);
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
  let resumeOrgIndex = parseResumeOrgIndex(cursor.cursorValue);
  const today = new Date();
  const jobStart = Date.now();

  let totalIn = 0;
  let totalOut = 0;

  try {
    windowLoop: while (windowStart < today) {
      const windowEnd = min([addMonths(windowStart, 1), today]);
      const startDate = format(windowStart, "dd/MM/yyyy");
      const endDate = format(windowEnd, "dd/MM/yyyy");

      if (resumeOrgIndex > 0) {
        console.log(`[ingest-transparencia] Contratos window ${startDate} → ${endDate} (resume at org ${resumeOrgIndex}/${FEDERAL_ORGANS.length})`);
      } else {
        console.log(`[ingest-transparencia] Contratos window ${startDate} → ${endDate}`);
      }

      for (let orgIdx = resumeOrgIndex; orgIdx < FEDERAL_ORGANS.length; orgIdx++) {
        const orgCode = FEDERAL_ORGANS[orgIdx];
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

        await updateCursor(cursor.id, {
          cursorValue: String(orgIdx + 1),
          totalFetched: cursor.totalFetched + totalOut,
        });

        if (Date.now() - jobStart > PER_JOB_BUDGET_MS) {
          console.log(`[ingest-transparencia] Contratos budget exhausted after org ${orgIdx + 1}/${FEDERAL_ORGANS.length} in window ${startDate} → ${endDate}; yielding`);
          await updateCursor(cursor.id, { status: "IDLE", lastError: null });
          return { recordsIn: totalIn, recordsOut: totalOut };
        }

        await sleep(POLITE_DELAY_MS);
      }

      console.log(`[ingest-transparencia] Contratos window done: ${totalIn} fetched so far`);

      await updateCursor(cursor.id, {
        lastFetchedAt: windowEnd,
        cursorValue: "0",
        totalFetched: cursor.totalFetched + totalOut,
      });

      windowStart = windowEnd;
      resumeOrgIndex = 0;

      if (Date.now() - jobStart > PER_JOB_BUDGET_MS) {
        console.log(`[ingest-transparencia] Contratos budget exhausted after window ${startDate} → ${endDate}; yielding`);
        break windowLoop;
      }
    }

    console.log(`[ingest-transparencia] Contratos tick complete: ${totalIn} fetched, ${totalOut} saved`);
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
