import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { fetchServidorByCpf } from "@/lib/gov-apis/transparencia";
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";

const BATCH_SIZE = 15;
const POLITE_DELAY_MS = 2200;
const BUDGET_MS = 100_000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ingestServidores() {
  return runJob("ingest-servidores", "ingestion", async () => {
    const politicians = await prisma.politician.findMany({
      select: { cpf: true },
    });

    const alreadyFetched = await prisma.rawRecord.findMany({
      where: {
        source: "TRANSPARENCIA",
        recordType: "servant",
      },
      select: { externalId: true },
    });
    const fetchedCpfs = new Set(alreadyFetched.map((r) => r.externalId));

    const toFetch = politicians.filter((p) => !fetchedCpfs.has(p.cpf));
    const batch = toFetch.slice(0, BATCH_SIZE);

    console.log(
      `[ingest-servidores] ${politicians.length} politicians, ${fetchedCpfs.size} already checked, fetching ${batch.length}`,
    );

    let recordsOut = 0;
    const budget = new BudgetTracker(BUDGET_MS);

    for (const politician of batch) {
      if (budget.exceeded()) {
        console.log(`[ingest-servidores] Budget exhausted; yielding`);
        break;
      }
      try {
        const result = await fetchServidorByCpf(politician.cpf);

        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "TRANSPARENCIA",
              recordType: "servant",
              externalId: politician.cpf,
            },
          },
          create: {
            source: "TRANSPARENCIA",
            recordType: "servant",
            externalId: politician.cpf,
            data: (result ?? { _empty: true }) as unknown as Prisma.InputJsonValue,
          },
          update: {
            data: (result ?? { _empty: true }) as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
            processedAt: null,
          },
        });
        recordsOut++;
      } catch (err) {
        console.warn(
          `[ingest-servidores] Failed for CPF ${politician.cpf}:`,
          err instanceof Error ? err.message : err,
        );
      }

      await sleep(POLITE_DELAY_MS);
    }

    return { recordsIn: batch.length, recordsOut };
  });
}
