import { prisma } from "@sentinel/server/lib/prisma";
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

function parseBrDate(dateStr: string): Date | null {
  if (!dateStr || dateStr.length < 8) return null;
  const parts = dateStr.split("/");
  if (parts.length === 3) {
    const d = new Date(`${parts[2]}-${parts[1]}-${parts[0]}`);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

interface DeputyData {
  id: number;
  name: string;
  cpf: string;
  civilName: string;
  party: string;
  state: string;
  photoUrl: string;
  legislature: number;
  birthDate: string | null;
  education: string | null;
}

export async function processPoliticians() {
  return runJob("process-politicians", "processing", async () => {
    const rawRecords = await prisma.rawRecord.findMany({
      where: {
        source: { in: ["TSE", "CAMARA"] },
        recordType: { in: ["candidate", "deputy"] },
        processedAt: null,
      },
      take: BATCH_SIZE * 50,
      orderBy: { fetchedAt: "asc" },
    });

    let recordsOut = 0;

    for (let i = 0; i < rawRecords.length; i += BATCH_SIZE) {
      const batch = rawRecords.slice(i, i + BATCH_SIZE);

      for (const raw of batch) {
        try {
          if (raw.recordType === "candidate") {
            await processCandidateRecord(raw.id, raw.data as unknown as RawRow);
          } else if (raw.recordType === "deputy") {
            await processDeputyRecord(raw.id, raw.data as unknown as DeputyData);
          }

          await prisma.rawRecord.update({
            where: { id: raw.id },
            data: { processedAt: new Date() },
          });
          recordsOut++;
        } catch (err) {
          const msg = err instanceof Error ? err.message : "Unknown error";
          console.error(`[process-politicians] Error processing ${raw.id}:`, msg);
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

async function processCandidateRecord(rawId: string, data: RawRow) {
  const rawCpf = findCol(data, /NR_CPF_CANDIDATO/i) || (data as unknown as { cpf?: string }).cpf;
  if (!rawCpf) return;
  const cpf = cleanCpf(String(rawCpf));
  if (cpf.length !== 11 || cpf === "00000000000") return;

  const name = findCol(data, /^NM_CANDIDATO$/i) || (data as unknown as { name?: string }).name || "";
  const ballotName = findCol(data, /NM_URNA_CANDIDATO/i) || (data as unknown as { ballotName?: string }).ballotName || "";
  const party = findCol(data, /^SG_PARTIDO$/i) || (data as unknown as { party?: string }).party || "";
  const position = findCol(data, /^DS_CARGO$/i) || (data as unknown as { position?: string }).position || "";
  const state = findCol(data, /^SG_UF$/i) || (data as unknown as { state?: string }).state || "";
  const city = findCol(data, /^NM_UE$/i) || (data as unknown as { city?: string }).city || "";
  const yearStr = data._year ?? findCol(data, /^ANO_ELEICAO$/i);
  const electionYear = parseInt(String(yearStr)) || null;

  const resultStr = findCol(data, /DS_SIT_TOT_TURNO/i).toUpperCase();
  const elected = resultStr.includes("ELEITO") && !resultStr.includes("NÃO ELEITO") && !resultStr.includes("NAO ELEITO");

  const birthDate = parseBrDate(findCol(data, /^DT_NASCIMENTO$/i));
  const birthState = findCol(data, /^SG_UF_NASCIMENTO$/i) || null;
  const birthCity = findCol(data, /^NM_MUNICIPIO_NASCIMENTO$/i) || null;
  const gender = findCol(data, /^DS_GENERO$/i) || null;
  const education = findCol(data, /^DS_GRAU_INSTRUCAO$/i) || null;
  const maritalStatus = findCol(data, /^DS_ESTADO_CIVIL$/i) || null;
  const occupation = findCol(data, /^DS_OCUPACAO$/i) || null;
  const email = findCol(data, /^NM_EMAIL$/i) || null;

  if (!position) return;

  await prisma.politician.upsert({
    where: { cpf },
    create: {
      cpf,
      name,
      ballotName: ballotName || null,
      party: party || null,
      position,
      state: state || null,
      city: city || null,
      electionYear,
      elected,
      birthDate,
      birthState,
      birthCity,
      gender,
      education,
      maritalStatus,
      occupation,
      email,
      rawRecordId: rawId,
    },
    update: {
      name: name || undefined,
      ballotName: ballotName || undefined,
      party: party || undefined,
      position: position || undefined,
      state: state || undefined,
      city: city || undefined,
      electionYear: electionYear ?? undefined,
      elected,
      birthDate: birthDate ?? undefined,
      birthState: birthState ?? undefined,
      birthCity: birthCity ?? undefined,
      gender: gender ?? undefined,
      education: education ?? undefined,
      maritalStatus: maritalStatus ?? undefined,
      occupation: occupation ?? undefined,
      email: email ?? undefined,
      rawRecordId: rawId,
    },
  });
}

async function processDeputyRecord(rawId: string, data: DeputyData) {
  const cpf = (data.cpf ?? "").replace(/\D/g, "").padStart(11, "0");
  if (cpf.length !== 11 || cpf === "00000000000") return;

  await prisma.politician.upsert({
    where: { cpf },
    create: {
      cpf,
      name: data.civilName || data.name,
      ballotName: data.name,
      party: data.party,
      position: "Deputado Federal",
      state: data.state,
      active: true,
      elected: true,
      photoUrl: data.photoUrl,
      externalId: String(data.id),
      education: data.education,
      rawRecordId: rawId,
    },
    update: {
      party: data.party,
      state: data.state,
      active: true,
      photoUrl: data.photoUrl,
      externalId: String(data.id),
      ballotName: data.name,
      education: data.education ?? undefined,
      rawRecordId: rawId,
    },
  });
}
