import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { streamTseCandidates, cleanCpf, type TseRawRow } from "@/lib/gov-apis/tse";
import { fetchDeputies, fetchDeputyDetail } from "@/lib/gov-apis/camara";
import { BudgetTracker, YieldSignal } from "@sentinel/server/lib/budget-tracker";

const ELECTION_YEARS = [2020, 2022, 2024];
const CAMARA_BATCH_SIZE = 5;
const POLITE_DELAY_MS = 2000;
const TOTAL_BUDGET_MS = 120_000;
const CURSOR_SAVE_EVERY = 500;
const RECENT_FETCH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function findCol(row: Record<string, string>, pattern: RegExp): string {
  for (const key of Object.keys(row)) {
    if (pattern.test(key)) return row[key] ?? "";
  }
  return "";
}

export async function ingestPoliticians() {
  return runJob("ingest-politicians", "ingestion", async () => {
    const budget = new BudgetTracker(TOTAL_BUDGET_MS);
    let totalIn = 0;
    let totalOut = 0;

    for (let i = 0; i < ELECTION_YEARS.length; i++) {
      if (budget.exceeded()) {
        console.log(`[ingest-politicians] Budget exhausted before year ${ELECTION_YEARS[i]}; deferring to next tick`);
        break;
      }
      try {
        const result = await ingestTseCandidates(ELECTION_YEARS[i]!, budget);
        totalIn += result.recordsIn;
        totalOut += result.recordsOut;
      } catch (e) {
        console.warn(
          `[ingest-politicians] TSE ${ELECTION_YEARS[i]} failed:`,
          e instanceof Error ? e.message : e,
        );
      }
      if (i < ELECTION_YEARS.length - 1) await sleep(POLITE_DELAY_MS);
    }

    if (!budget.exceeded()) {
      try {
        const camaraResult = await ingestCamaraDeputies(budget);
        totalIn += camaraResult.recordsIn;
        totalOut += camaraResult.recordsOut;
      } catch (e) {
        console.warn("[ingest-politicians] Camara failed:", e instanceof Error ? e.message : e);
      }
    }

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}

async function ingestTseCandidates(year: number, budget: BudgetTracker) {
  const endpoint = `candidaturas/${year}`;
  const cursor = await getOrCreateCursor("TSE", endpoint, new Date(0));

  const resumeOffset = Math.max(0, parseInt(cursor.cursorValue ?? "0", 10) || 0);
  const sinceLast = Date.now() - cursor.lastFetchedAt.getTime();
  if (sinceLast < RECENT_FETCH_INTERVAL_MS && resumeOffset === 0) {
    console.log(`[ingest-politicians] TSE ${year} fetched ${Math.round(sinceLast / 3600_000)}h ago; skipping`);
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  let rowIdx = 0;
  let recordsIn = 0;
  let recordsOut = 0;

  try {
    await streamTseCandidates(year, async (row: TseRawRow) => {
      const currentIdx = rowIdx++;
      if (currentIdx < resumeOffset) return;

      recordsIn++;

      const rawCpf = findCol(row, /NR_CPF_CANDIDATO/i);
      const cpf = cleanCpf(rawCpf);
      if (cpf.length < 11 || cpf === "00000000000") return;

      try {
        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "TSE",
              recordType: "candidate",
              externalId: `${year}-${cpf}`,
            },
          },
          create: {
            source: "TSE",
            recordType: "candidate",
            externalId: `${year}-${cpf}`,
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
        console.error(`[ingest-politicians] Error saving candidate ${cpf}:`, err);
      }

      if (recordsOut > 0 && recordsOut % CURSOR_SAVE_EVERY === 0) {
        await updateCursor(cursor.id, {
          cursorValue: String(currentIdx + 1),
          totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
        });
        if (budget.exceeded()) {
          console.log(`[ingest-politicians] TSE ${year} budget exhausted at row ${currentIdx + 1}; yielding`);
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
    console.log(`[ingest-politicians] TSE ${year} complete: ${recordsIn} fetched, ${recordsOut} saved`);
  } catch (err) {
    if (err instanceof YieldSignal) {
      await updateCursor(cursor.id, { status: "IDLE", lastError: null });
      return { recordsIn, recordsOut };
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ingest-politicians] TSE ${year} failed:`, msg);
    await updateCursor(cursor.id, { status: "FAILED", lastError: msg });
  }

  return { recordsIn, recordsOut };
}

async function ingestCamaraDeputies(budget: BudgetTracker) {
  const endpoint = "deputados";
  const cursor = await getOrCreateCursor("CAMARA", endpoint, new Date(0));

  const sinceLast = Date.now() - cursor.lastFetchedAt.getTime();
  const resumeOffset = Math.max(0, parseInt(cursor.cursorValue ?? "0", 10) || 0);
  if (sinceLast < RECENT_FETCH_INTERVAL_MS && resumeOffset === 0) {
    console.log("[ingest-politicians] Camara deputies fetched recently; skipping");
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  let recordsIn = 0;
  let recordsOut = 0;

  try {
    const deputies = await fetchDeputies();
    recordsIn = deputies.length;

    for (let i = resumeOffset; i < deputies.length; i += CAMARA_BATCH_SIZE) {
      if (budget.exceeded()) {
        console.log(`[ingest-politicians] Camara budget exhausted at ${i}/${deputies.length}; yielding`);
        await updateCursor(cursor.id, {
          status: "IDLE",
          cursorValue: String(i),
          totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
          lastError: null,
        });
        return { recordsIn, recordsOut };
      }

      const batch = deputies.slice(i, i + CAMARA_BATCH_SIZE);
      const details = await Promise.allSettled(batch.map((d) => fetchDeputyDetail(d.id)));

      for (let j = 0; j < batch.length; j++) {
        const deputy = batch[j]!;
        const detailResult = details[j]!;
        const detail = detailResult.status === "fulfilled" ? detailResult.value : null;

        const data = {
          ...deputy,
          cpf: detail?.cpf ?? "",
          civilName: detail?.civilName ?? "",
          birthDate: detail?.birthDate ?? null,
          education: detail?.education ?? null,
        };

        if (!data.cpf) continue;

        try {
          await prisma.rawRecord.upsert({
            where: {
              source_recordType_externalId: {
                source: "CAMARA",
                recordType: "deputy",
                externalId: String(deputy.id),
              },
            },
            create: {
              source: "CAMARA",
              recordType: "deputy",
              externalId: String(deputy.id),
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
          console.error(`[ingest-politicians] Error saving deputy ${deputy.id}:`, err);
        }
      }

      await updateCursor(cursor.id, {
        cursorValue: String(i + CAMARA_BATCH_SIZE),
        totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
      });

      if (i + CAMARA_BATCH_SIZE < deputies.length) {
        await sleep(POLITE_DELAY_MS);
      }
    }

    await updateCursor(cursor.id, {
      status: "COMPLETED",
      lastFetchedAt: new Date(),
      cursorValue: "0",
      totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
      lastError: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[ingest-politicians] Camara failed:", msg);
    await updateCursor(cursor.id, { status: "FAILED", lastError: msg });
  }

  return { recordsIn, recordsOut };
}
