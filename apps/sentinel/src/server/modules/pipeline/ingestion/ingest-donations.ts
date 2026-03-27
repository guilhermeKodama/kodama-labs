import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import { fetchTseDonations } from "@/lib/gov-apis/tse";

const ELECTION_YEARS = [2020, 2022, 2024];
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

export async function ingestDonations() {
  return runJob("ingest-donations", "ingestion", async () => {
    let totalIn = 0;
    let totalOut = 0;

    for (let i = 0; i < ELECTION_YEARS.length; i++) {
      const result = await ingestTseDonations(ELECTION_YEARS[i]!);
      totalIn += result.recordsIn;
      totalOut += result.recordsOut;
      if (i < ELECTION_YEARS.length - 1) await sleep(POLITE_DELAY_MS);
    }

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}

async function ingestTseDonations(year: number) {
  const endpoint = `prestacao_contas/${year}`;
  const cursor = await getOrCreateCursor("TSE", endpoint, new Date(0));

  const daysSinceLastFetch =
    (Date.now() - cursor.lastFetchedAt.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceLastFetch < 7) {
    console.log(`[ingest-donations] TSE donations ${year} already fetched recently, skipping`);
    return { recordsIn: 0, recordsOut: 0 };
  }

  await updateCursor(cursor.id, { status: "RUNNING" });

  let recordsIn = 0;
  let recordsOut = 0;

  try {
    const rows = await fetchTseDonations(year);
    recordsIn = rows.length;

    const validRows = rows.filter((row) => {
      const cpfCnpj = (
        row.NR_CPF_CNPJ_DOADOR ?? row.NR_CPF_CNPJ_DOADOR_ORIGINARIO ?? ""
      ).replace(/\D/g, "");
      const amountStr = (row.VR_RECEITA ?? "").replace(",", ".");
      const amount = parseFloat(amountStr);
      return cpfCnpj.length > 0 && !isNaN(amount) && amount > 0;
    });

    console.log(`[ingest-donations] ${year}: ${rows.length} total rows, ${validRows.length} with valid donor + amount`);

    for (const row of validRows) {
      const seq = row.SQ_CANDIDATO ?? row.SQ_PRESTADOR_CONTAS ?? "";
      const cpfCnpj = (
        row.NR_CPF_CNPJ_DOADOR ?? row.NR_CPF_CNPJ_DOADOR_ORIGINARIO ?? ""
      ).replace(/\D/g, "");
      const amount = (row.VR_RECEITA ?? "").replace(",", ".");
      const externalId = `${year}-${seq}-${cpfCnpj}-${amount}`;

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
    }

    await updateCursor(cursor.id, {
      status: "COMPLETED",
      lastFetchedAt: new Date(),
      totalFetched: (cursor.totalFetched ?? 0) + recordsOut,
      lastError: null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[ingest-donations] TSE ${year} failed:`, msg);
    await updateCursor(cursor.id, { status: "FAILED", lastError: msg });
  }

  return { recordsIn, recordsOut };
}
