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

export async function processDonations() {
  return runJob("process-donations", "processing", async () => {
    const rawRecords = await prisma.rawRecord.findMany({
      where: {
        source: "TSE",
        recordType: "donation",
        processedAt: null,
      },
      take: BATCH_SIZE * 50,
      orderBy: { fetchedAt: "asc" },
    });

    const candidateSeqs = [
      ...new Set(rawRecords.map((r) => findCol(r.data as unknown as RawRow, /SQ_CANDIDATO/i))),
    ].filter(Boolean);

    const candidateRawRecords = await prisma.rawRecord.findMany({
      where: {
        source: "TSE",
        recordType: "candidate",
        externalId: {
          in: candidateSeqs.flatMap((seq) => [
            `2020-${seq}`,
            `2022-${seq}`,
            `2024-${seq}`,
          ]),
        },
      },
      select: { data: true, externalId: true },
    });

    const seqToCpf = new Map<string, string>();
    for (const r of candidateRawRecords) {
      const d = r.data as unknown as RawRow;
      const seq = findCol(d, /SQ_CANDIDATO/i);
      const rawCpf = findCol(d, /NR_CPF_CANDIDATO/i);
      if (rawCpf && seq) {
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
          const candidateSeq = findCol(data, /SQ_CANDIDATO/i);
          const cpf = seqToCpf.get(candidateSeq);
          const politicianId = cpf ? cpfToPoliticianId.get(cpf) : undefined;

          if (!politicianId) {
            await prisma.rawRecord.update({
              where: { id: raw.id },
              data: { processingError: `No politician found for seq ${candidateSeq}` },
            });
            continue;
          }

          const donorCpfCnpj = findCol(data, /NR_CPF_CNPJ_DOADOR/i).replace(/\D/g, "");
          const donorType = donorCpfCnpj.length === 14 ? "PJ" : donorCpfCnpj.length === 11 ? "PF" : "OUTRO";
          const amountStr = findCol(data, /VR_RECEITA/i).replace(",", ".");
          const amount = parseFloat(amountStr) || 0;
          const year = parseInt(data._year ?? "") || parseInt(findCol(data, /ANO_ELEICAO/i)) || 0;

          await prisma.campaignDonation.create({
            data: {
              politicianId,
              donorName: findCol(data, /NM_DOADOR/i),
              donorCpfCnpj,
              donorType,
              amount: new Prisma.Decimal(amount),
              electionYear: year,
              description: findCol(data, /DS_RECEITA/i) || null,
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
          console.error(`[process-donations] Error processing ${raw.id}:`, msg);
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
