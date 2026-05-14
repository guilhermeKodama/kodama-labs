import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchSenadores, fetchSenadorDetail } from "@/lib/gov-apis/senado";
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";

const BATCH_SIZE = 5;
const POLITE_DELAY_MS = 2000;
const BUDGET_MS = 100_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ingestSenadores() {
  return runJob("ingest-senadores", "ingestion", async () => {
    const endpoint = "senadores";
    const cursor = await getOrCreateCursor("SENADO", endpoint, new Date(0));

    const daysSinceLastFetch =
      (Date.now() - cursor.lastFetchedAt.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceLastFetch < 7) {
      console.log("[ingest-senadores] Already fetched recently, skipping");
      return { recordsIn: 0, recordsOut: 0 };
    }

    await updateCursor(cursor.id, { status: "RUNNING" });

    let recordsIn = 0;
    let recordsOut = 0;

    try {
      const senadores = await fetchSenadores();
      recordsIn = senadores.length;
      const budget = new BudgetTracker(BUDGET_MS);

      for (let i = 0; i < senadores.length; i += BATCH_SIZE) {
        if (budget.exceeded()) {
          console.log(`[ingest-senadores] Budget exhausted at ${i}/${senadores.length}; yielding`);
          break;
        }
        const batch = senadores.slice(i, i + BATCH_SIZE);

        const details = await Promise.allSettled(
          batch.map((s) => fetchSenadorDetail(s.codigoParlamentar))
        );

        for (let j = 0; j < batch.length; j++) {
          const senador = batch[j]!;
          const detailResult = details[j]!;
          const detail =
            detailResult.status === "fulfilled" ? detailResult.value : null;

          const data = {
            ...senador,
            dataNascimento: detail?.dataNascimento ?? null,
            naturalidade: detail?.naturalidade ?? null,
            ufNaturalidade: detail?.ufNaturalidade ?? null,
          };

          try {
            await prisma.rawRecord.upsert({
              where: {
                source_recordType_externalId: {
                  source: "SENADO",
                  recordType: "senator",
                  externalId: `senado-${senador.codigoParlamentar}`,
                },
              },
              create: {
              source: "SENADO",
              recordType: "senator",
              externalId: `senado-${senador.codigoParlamentar}`,
              data: data as unknown as Prisma.InputJsonValue,
            },
            update: {
                data: data as unknown as Prisma.InputJsonValue,
                fetchedAt: new Date(),
                processedAt: null,
              },
            });
            recordsOut++;
          } catch (err) {
            console.error(
              `[ingest-senadores] Error saving senator ${senador.codigoParlamentar}:`,
              err
            );
          }
        }

        if (i + BATCH_SIZE < senadores.length) {
          await sleep(POLITE_DELAY_MS);
        }
      }

      console.log(`[ingest-senadores] ${recordsIn} fetched, ${recordsOut} saved`);

      await updateCursor(cursor.id, {
        status: "COMPLETED",
        lastFetchedAt: new Date(),
        totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
        lastError: null,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      console.error("[ingest-senadores] Failed:", msg);
      await updateCursor(cursor.id, { status: "FAILED", lastError: msg });
    }

    return { recordsIn, recordsOut };
  });
}
