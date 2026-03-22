import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { cleanCpf } from "@/lib/gov-apis/tse";

const BATCH_SIZE = 500;

type RawRow = Record<string, string>;

function findCol(row: RawRow, pattern: RegExp): string {
  for (const key of Object.keys(row)) {
    if (pattern.test(key)) return row[key] ?? "";
  }
  return "";
}

export async function processAssets() {
  return runJob("process-assets", "processing", async () => {
    const rawRecords = await prisma.rawRecord.findMany({
      where: {
        source: "TSE",
        recordType: "asset",
        processedAt: null,
      },
      take: BATCH_SIZE * 50,
      orderBy: { fetchedAt: "asc" },
    });

    const candidateRaws = await prisma.rawRecord.findMany({
      where: {
        source: "TSE",
        recordType: "candidate",
      },
      select: { data: true },
    });

    const seqToCpf = new Map<string, string>();
    for (const r of candidateRaws) {
      const d = r.data as unknown as RawRow;
      const seq = findCol(d, /SQ_CANDIDATO/i);
      const rawCpf = findCol(d, /NR_CPF_CANDIDATO/i);
      if (seq && rawCpf) {
        seqToCpf.set(seq, cleanCpf(rawCpf));
      }
    }

    const allPoliticians = await prisma.politician.findMany({
      select: { id: true, cpf: true },
    });
    const cpfToPoliticianId = new Map(allPoliticians.map((p) => [p.cpf, p.id]));

    let recordsOut = 0;

    for (let i = 0; i < rawRecords.length; i += BATCH_SIZE) {
      const batch = rawRecords.slice(i, i + BATCH_SIZE);

      for (const raw of batch) {
        try {
          const data = raw.data as unknown as RawRow;
          const seq = findCol(data, /SQ_CANDIDATO/i);
          const cpf = seqToCpf.get(seq);
          const politicianId = cpf ? cpfToPoliticianId.get(cpf) : undefined;

          if (!politicianId) {
            await prisma.rawRecord.update({
              where: { id: raw.id },
              data: { processingError: `No politician found for seq ${seq}` },
            });
            continue;
          }

          const assetType = findCol(data, /DS_TIPO_BEM_CANDIDATO/i) || findCol(data, /CD_TIPO_BEM_CANDIDATO/i) || "DESCONHECIDO";
          const description = findCol(data, /DS_BEM_CANDIDATO/i) || "";
          const valueStr = findCol(data, /VR_BEM_CANDIDATO/i).replace(",", ".");
          const value = parseFloat(valueStr) || 0;
          const yearStr = data._year ?? findCol(data, /ANO_ELEICAO/i);
          const electionYear = parseInt(yearStr) || 0;

          if (electionYear === 0) {
            await prisma.rawRecord.update({
              where: { id: raw.id },
              data: { processingError: "Missing election year" },
            });
            continue;
          }

          await prisma.candidateAsset.create({
            data: {
              politicianId,
              assetType,
              description,
              value: new Prisma.Decimal(value),
              electionYear,
              rawRecordId: raw.id,
            },
          });

          await prisma.rawRecord.update({
            where: { id: raw.id },
            data: { processedAt: new Date() },
          });
          recordsOut++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(`[process-assets] Error processing ${raw.id}:`, msg);
          await prisma.rawRecord.update({
            where: { id: raw.id },
            data: { processingError: msg },
          });
        }
      }
    }

    return { recordsIn: rawRecords.length, recordsOut };
  });
}
