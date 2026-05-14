import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import { getCpfToPoliticianId } from "@sentinel/server/lib/politician-cache";
import { cleanCpf } from "@/lib/gov-apis/tse";

const BATCH_SIZE = 500;

type RawRow = Record<string, string>;

function getCol(row: RawRow, exact: string): string {
  return row[exact] ?? "";
}

export async function processDonations() {
  return runJob("process-donations", "processing", async () => {
    const rawRecords = await prisma.rawRecord.findMany({
      where: {
        source: "TSE",
        recordType: "donation",
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!rawRecords.length) return { recordsIn: 0, recordsOut: 0 };

    const cpfToPoliticianId = await getCpfToPoliticianId();

    // For "doacao_originario" records that only have SQ_PRESTADOR_CONTAS,
    // build a mapping from SQ_PRESTADOR_CONTAS → NR_CPF_CANDIDATO using
    // the main receitas records (which have both fields).
    const prestadorSeqs = new Set<string>();
    for (const raw of rawRecords) {
      const data = raw.data as unknown as RawRow;
      if (!data.NR_CPF_CANDIDATO && data.SQ_PRESTADOR_CONTAS) {
        prestadorSeqs.add(data.SQ_PRESTADOR_CONTAS);
      }
    }

    const prestadorToCpf = new Map<string, string>();
    if (prestadorSeqs.size > 0) {
      const seqArr = [...prestadorSeqs];
      const CHUNK = 500;
      for (let i = 0; i < seqArr.length; i += CHUNK) {
        const batch = seqArr.slice(i, i + CHUNK);
        const bridgeRecords: { data: unknown }[] =
          await prisma.$queryRawUnsafe(
            `SELECT data FROM raw_records
             WHERE source = 'TSE' AND "recordType" = 'donation'
               AND data ? 'NR_CPF_CANDIDATO'
               AND data->>'SQ_PRESTADOR_CONTAS' = ANY($1)`,
            batch
          );
        for (const r of bridgeRecords) {
          const d = r.data as RawRow;
          if (d.SQ_PRESTADOR_CONTAS && d.NR_CPF_CANDIDATO) {
            prestadorToCpf.set(
              d.SQ_PRESTADOR_CONTAS,
              cleanCpf(d.NR_CPF_CANDIDATO)
            );
          }
        }
      }
    }

    const successIds: string[] = [];
    const errs: { id: string; error: string }[] = [];
    const toCreate: Prisma.CampaignDonationCreateManyInput[] = [];

    for (const raw of rawRecords) {
      const data = raw.data as unknown as RawRow;

      let politicianId: string | undefined;

      const cpfCandidato = getCol(data, "NR_CPF_CANDIDATO");
      if (cpfCandidato) {
        politicianId = cpfToPoliticianId.get(cleanCpf(cpfCandidato));
      }

      if (!politicianId) {
        const prestadorSeq = getCol(data, "SQ_PRESTADOR_CONTAS");
        const bridgedCpf = prestadorToCpf.get(prestadorSeq);
        if (bridgedCpf) {
          politicianId = cpfToPoliticianId.get(bridgedCpf);
        }
      }

      if (!politicianId) {
        const sqCandidato = getCol(data, "SQ_CANDIDATO");
        if (sqCandidato) {
          const years = ["2020", "2022", "2024"];
          const extIds = years.map((y) => `${y}-${sqCandidato}`);
          const cand = await prisma.rawRecord.findFirst({
            where: {
              source: "TSE",
              recordType: "candidate",
              externalId: { in: extIds },
            },
            select: { data: true },
          });
          if (cand) {
            const candCpf = (cand.data as unknown as RawRow).NR_CPF_CANDIDATO;
            if (candCpf) {
              politicianId = cpfToPoliticianId.get(cleanCpf(candCpf));
            }
          }
        }
      }

      if (!politicianId) {
        if (!cpfCandidato && !getCol(data, "SQ_CANDIDATO")) {
          successIds.push(raw.id);
        } else {
          errs.push({
            id: raw.id,
            error: `No politician found (cpf=${cpfCandidato || "none"}, prestador=${getCol(data, "SQ_PRESTADOR_CONTAS") || "none"})`,
          });
        }
        continue;
      }

      const donorCpfCnpj = (
        getCol(data, "NR_CPF_CNPJ_DOADOR") ||
        getCol(data, "NR_CPF_CNPJ_DOADOR_ORIGINARIO")
      ).replace(/\D/g, "");
      const donorType =
        donorCpfCnpj.length === 14
          ? "PJ"
          : donorCpfCnpj.length === 11
            ? "PF"
            : "OUTRO";
      const amountStr = getCol(data, "VR_RECEITA").replace(",", ".");
      const amount = parseFloat(amountStr) || 0;
      const year =
        parseInt(data._year ?? "") ||
        parseInt(getCol(data, "AA_ELEICAO")) ||
        0;

      const donationDateStr = getCol(data, "DT_RECEITA");
      let donationDate: Date | undefined;
      if (donationDateStr) {
        const [dd, mm, yyyy] = donationDateStr.split("/");
        if (dd && mm && yyyy) {
          const d = new Date(`${yyyy}-${mm}-${dd}T00:00:00Z`);
          if (!isNaN(d.getTime())) donationDate = d;
        }
      }

      const cnae = getCol(data, "DS_CNAE_DOADOR") || getCol(data, "DS_CNAE_DOADOR_ORIGINARIO");
      const donorState = getCol(data, "SG_UF_DOADOR");
      const donorCity = getCol(data, "NM_MUNICIPIO_DOADOR");

      toCreate.push({
        politicianId,
        donorName:
          getCol(data, "NM_DOADOR") ||
          getCol(data, "NM_DOADOR_ORIGINARIO"),
        donorCpfCnpj,
        donorType,
        amount: new Prisma.Decimal(amount),
        electionYear: year,
        description: getCol(data, "DS_RECEITA") || null,
        rawRecordId: raw.id,
        donorNameRfb:
          getCol(data, "NM_DOADOR_RFB") ||
          getCol(data, "NM_DOADOR_ORIGINARIO_RFB") || null,
        donorCnae: cnae && cnae !== "#NULO" ? cnae : null,
        donorState: donorState && donorState !== "#NULO#" ? donorState : null,
        donorCity: donorCity && donorCity !== "#NULO" ? donorCity : null,
        donationDate,
        receiptNumber: getCol(data, "NR_RECIBO_DOACAO") || null,
        originType: getCol(data, "DS_ORIGEM_RECEITA") || null,
        sourceType: getCol(data, "DS_FONTE_RECEITA") || null,
        speciesType: getCol(data, "DS_ESPECIE_RECEITA") || null,
        candidateName: getCol(data, "NM_CANDIDATO") || null,
        candidateParty: getCol(data, "SG_PARTIDO") || null,
        candidatePosition: getCol(data, "DS_CARGO") || null,
        state: getCol(data, "SG_UF") || null,
      });
      successIds.push(raw.id);
    }

    if (toCreate.length > 0) {
      const CHUNK = 1000;
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        try {
          await prisma.campaignDonation.createMany({
            data: toCreate.slice(i, i + CHUNK),
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "createMany error";
          console.error("[process-donations] createMany failed:", msg);
          const failedChunk = toCreate.slice(i, i + CHUNK);
          for (const item of failedChunk) {
            const rid = item.rawRecordId;
            if (!rid) continue;
            const idx = successIds.indexOf(rid);
            if (idx !== -1) successIds.splice(idx, 1);
            errs.push({ id: rid, error: msg });
          }
        }
      }
    }

    await markProcessed(successIds);
    await markErrors(errs);

    return { recordsIn: rawRecords.length, recordsOut: successIds.length };
  });
}
