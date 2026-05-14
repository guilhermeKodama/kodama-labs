import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { streamTseDonations, type TseRawRow } from "@/lib/gov-apis/tse";
import { BudgetTracker, YieldSignal } from "@sentinel/server/lib/budget-tracker";

const ELECTION_YEARS = [2020, 2022, 2024];
const POLITE_DELAY_MS = 2000;
const TOTAL_BUDGET_MS = 120_000;
const CURSOR_SAVE_EVERY = 500;
const RECENT_FETCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ingestDonations() {
  return runJob("ingest-donations", "ingestion", async () => {
    const budget = new BudgetTracker(TOTAL_BUDGET_MS);
    let totalIn = 0;
    let totalOut = 0;

    for (let i = 0; i < ELECTION_YEARS.length; i++) {
      if (budget.exceeded()) {
        console.log(`[ingest-donations] Budget exhausted before year ${ELECTION_YEARS[i]}; deferring to next tick`);
        break;
      }
      try {
        const result = await ingestTseDonations(ELECTION_YEARS[i]!, budget);
        totalIn += result.recordsIn;
        totalOut += result.recordsOut;
      } catch (e) {
        console.warn(
          `[ingest-donations] TSE ${ELECTION_YEARS[i]} failed:`,
          e instanceof Error ? e.message : e,
        );
      }
      if (i < ELECTION_YEARS.length - 1) await sleep(POLITE_DELAY_MS);
    }

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}

async function ingestTseDonations(year: number, budget: BudgetTracker) {
  const endpoint = `prestacao_contas/${year}`;
  const cursor = await getOrCreateCursor("TSE", endpoint, new Date(0));

  const resumeOffset = Math.max(0, parseInt(cursor.cursorValue ?? "0", 10) || 0);
  const sinceLast = Date.now() - cursor.lastFetchedAt.getTime();
  if (sinceLast < RECENT_FETCH_INTERVAL_MS && resumeOffset === 0) {
    console.log(`[ingest-donations] TSE ${year} fetched ${Math.round(sinceLast / 3600_000)}h ago; skipping`);
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  let rowIdx = 0;
  let recordsIn = 0;
  let recordsOut = 0;

  try {
    await streamTseDonations(year, async (row: TseRawRow) => {
      const currentIdx = rowIdx++;
      if (currentIdx < resumeOffset) return;

      recordsIn++;

      const cpfCnpj = (
        row.NR_CPF_CNPJ_DOADOR ?? row.NR_CPF_CNPJ_DOADOR_ORIGINARIO ?? ""
      ).replace(/\D/g, "");
      const amountStr = (row.VR_RECEITA ?? "").replace(",", ".");
      const amount = parseFloat(amountStr);
      if (!cpfCnpj || isNaN(amount) || amount <= 0) return;

      const seq = row.SQ_CANDIDATO ?? row.SQ_PRESTADOR_CONTAS ?? "";
      const externalId = `${year}-${seq}-${cpfCnpj}-${amountStr}`;

      try {
        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "TSE",
              recordType: "donation",
              externalId,
            },
          },
          create: {
            source: "TSE",
            recordType: "donation",
            externalId,
            data: { ...row, _year: year } as unknown as Prisma.InputJsonValue,
          },
          update: {
            data: { ...row, _year: year } as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
            processedAt: null,
          },
        });
        recordsOut++;
      } catch (err) {
        console.error(`[ingest-donations] Error saving donation:`, err);
      }

      if (recordsOut > 0 && recordsOut % CURSOR_SAVE_EVERY === 0) {
        await updateCursor(cursor.id, {
          cursorValue: String(currentIdx + 1),
          totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
        });
        if (budget.exceeded()) {
          console.log(`[ingest-donations] TSE ${year} budget exhausted at row ${currentIdx + 1}; yielding`);
          throw new YieldSignal();
        }
      }
    });

    await updateCursor(cursor.id, {
      status: "COMPLETED",
      lastFetchedAt: new Date(),
      cursorValue: "0",
      totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
      lastError: null,
    });
    console.log(`[ingest-donations] TSE ${year} complete: ${recordsIn} fetched, ${recordsOut} saved`);
  } catch (err) {
    if (err instanceof YieldSignal) {
      await updateCursor(cursor.id, { status: "IDLE", lastError: null });
      return { recordsIn, recordsOut };
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ingest-donations] TSE ${year} failed:`, msg);
    await updateCursor(cursor.id, { status: "FAILED", lastError: msg });
  }

  return { recordsIn, recordsOut };
}
