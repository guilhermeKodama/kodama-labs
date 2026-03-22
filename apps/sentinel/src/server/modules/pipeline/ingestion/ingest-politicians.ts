import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchTseCandidates, cleanCpf } from "@/lib/gov-apis/tse";
import { fetchDeputies, fetchDeputyDetail } from "@/lib/gov-apis/camara";

const ELECTION_YEARS = [2020, 2022, 2024];
const CAMARA_BATCH_SIZE = 5;
const POLITE_DELAY_MS = 2000;

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
    let totalIn = 0;
    let totalOut = 0;

    for (let i = 0; i < ELECTION_YEARS.length; i++) {
      const result = await ingestTseCandidates(ELECTION_YEARS[i]!);
      totalIn += result.recordsIn;
      totalOut += result.recordsOut;
      if (i < ELECTION_YEARS.length - 1) await sleep(POLITE_DELAY_MS);
    }

    const camaraResult = await ingestCamaraDeputies();
    totalIn += camaraResult.recordsIn;
    totalOut += camaraResult.recordsOut;

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}

async function ingestTseCandidates(year: number) {
  const endpoint = `candidaturas/${year}`;
  const cursor = await getOrCreateCursor("TSE", endpoint, new Date(0));

  const daysSinceLastFetch =
    (Date.now() - cursor.lastFetchedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastFetch < 7) {
    console.log(`[ingest-politicians] TSE ${year} already fetched recently, skipping`);
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  let recordsIn = 0;
  let recordsOut = 0;

  try {
    const rows = await fetchTseCandidates(year);
    recordsIn = rows.length;

    for (const row of rows) {
      const rawCpf = findCol(row, /NR_CPF_CANDIDATO/i);
      const cpf = cleanCpf(rawCpf);
      if (cpf.length < 11 || cpf === "00000000000") continue;

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
    }

    await updateCursor(cursor.id, {
      status: "COMPLETED",
      lastFetchedAt: new Date(),
      totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
      lastError: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ingest-politicians] TSE ${year} failed:`, msg);
    await updateCursor(cursor.id, { status: "FAILED", lastError: msg });
  }

  return { recordsIn, recordsOut };
}

async function ingestCamaraDeputies() {
  const endpoint = "deputados";
  const cursor = await getOrCreateCursor("CAMARA", endpoint, new Date(0));

  const daysSinceLastFetch =
    (Date.now() - cursor.lastFetchedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastFetch < 7) {
    console.log("[ingest-politicians] Camara deputies already fetched recently, skipping");
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  let recordsIn = 0;
  let recordsOut = 0;

  try {
    const deputies = await fetchDeputies();
    recordsIn = deputies.length;

    for (let i = 0; i < deputies.length; i += CAMARA_BATCH_SIZE) {
      const batch = deputies.slice(i, i + CAMARA_BATCH_SIZE);

      const details = await Promise.allSettled(
        batch.map((d) => fetchDeputyDetail(d.id)),
      );

      for (let j = 0; j < batch.length; j++) {
        const deputy = batch[j]!;
        const detailResult = details[j]!;
        const detail =
          detailResult.status === "fulfilled" ? detailResult.value : null;

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

      if (i + CAMARA_BATCH_SIZE < deputies.length) {
        await sleep(POLITE_DELAY_MS);
      }
    }

    await updateCursor(cursor.id, {
      status: "COMPLETED",
      lastFetchedAt: new Date(),
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
