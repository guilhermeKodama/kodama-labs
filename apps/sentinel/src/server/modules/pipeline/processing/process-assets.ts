import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import { getCpfToPoliticianId, getSeqToCpfMap } from "@sentinel/server/lib/politician-cache";

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
        processingError: null,
      },
      select: { id: true, externalId: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (rawRecords.length === 0) return { recordsIn: 0, recordsOut: 0 };

    const seqToCpf = await getSeqToCpfMap();
    const cpfToPoliticianId = await getCpfToPoliticianId();

    const successIds: string[] = [];
    const errs: { id: string; error: string }[] = [];
    const toCreate: {
      politicianId: string;
      assetType: string;
      description: string;
      value: Prisma.Decimal;
      electionYear: number;
      rawRecordId: string;
    }[] = [];

    for (const raw of rawRecords) {
      const data = raw.data as unknown as RawRow;
      const seq = findCol(data, /SQ_CANDIDATO/i);
      const cpf = seqToCpf.get(seq);
      const politicianId = cpf ? cpfToPoliticianId.get(cpf) : undefined;

      if (!politicianId) {
        successIds.push(raw.id);
        continue;
      }

      const yearStr = data._year ?? findCol(data, /ANO_ELEICAO/i);
      const electionYear = parseInt(yearStr) || 0;
      if (electionYear === 0) {
        errs.push({ id: raw.id, error: "Missing election year" });
        continue;
      }

      const assetType = findCol(data, /DS_TIPO_BEM_CANDIDATO/i) || findCol(data, /CD_TIPO_BEM_CANDIDATO/i) || "DESCONHECIDO";
      const description = findCol(data, /DS_BEM_CANDIDATO/i) || "";
      const valueStr = findCol(data, /VR_BEM_CANDIDATO/i).replace(",", ".");
      const value = parseFloat(valueStr) || 0;

      toCreate.push({
        politicianId,
        assetType,
        description,
        value: new Prisma.Decimal(value),
        electionYear,
        rawRecordId: raw.id,
      });
      successIds.push(raw.id);
    }

    if (toCreate.length > 0) {
      const CHUNK = 1000;
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        try {
          await prisma.candidateAsset.createMany({
            data: toCreate.slice(i, i + CHUNK),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "createMany error";
          console.error("[process-assets] createMany failed:", msg);
          const failedChunk = toCreate.slice(i, i + CHUNK);
          for (const item of failedChunk) {
            const idx = successIds.indexOf(item.rawRecordId);
            if (idx !== -1) successIds.splice(idx, 1);
            errs.push({ id: item.rawRecordId, error: msg });
          }
        }
      }
    }

    await markProcessed(successIds);
    await markErrors(errs);

    return { recordsIn: rawRecords.length, recordsOut: successIds.length };
  });
}
