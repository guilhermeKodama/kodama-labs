import { prisma } from "@sentinel/server/lib/prisma";
import { runJob, markProcessed, markErrors, withDeadlockRetry } from "@sentinel/server/lib/job-runner";
import { invalidatePoliticianCache } from "@sentinel/server/lib/politician-cache";
import { cleanCpf } from "@/lib/gov-apis/tse";
import { randomUUID } from "crypto";

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

interface SenadorData {
  codigoParlamentar: string;
  nome: string;
  nomeCompleto: string;
  sexo: string;
  partido: string;
  uf: string;
  email: string | null;
  photoUrl: string;
  dataNascimento: string | null;
  naturalidade: string | null;
  ufNaturalidade: string | null;
}

interface CandidateTuple {
  rawId: string;
  cpf: string;
  name: string;
  ballotName: string | null;
  party: string | null;
  position: string;
  state: string | null;
  city: string | null;
  electionYear: number | null;
  elected: boolean;
  birthDate: Date | null;
  birthState: string | null;
  birthCity: string | null;
  gender: string | null;
  education: string | null;
  maritalStatus: string | null;
  occupation: string | null;
  email: string | null;
}

function extractCandidate(rawId: string, data: RawRow): CandidateTuple | null {
  const rawCpf = findCol(data, /NR_CPF_CANDIDATO/i) || (data as unknown as { cpf?: string }).cpf;
  if (!rawCpf) return null;
  const cpf = cleanCpf(String(rawCpf));
  if (cpf.length !== 11 || cpf === "00000000000") return null;

  const position = findCol(data, /^DS_CARGO$/i) || (data as unknown as { position?: string }).position || "";
  if (!position) return null;

  const name = findCol(data, /^NM_CANDIDATO$/i) || (data as unknown as { name?: string }).name || "";
  const ballotName = findCol(data, /NM_URNA_CANDIDATO/i) || (data as unknown as { ballotName?: string }).ballotName || "";
  const party = findCol(data, /^SG_PARTIDO$/i) || (data as unknown as { party?: string }).party || "";
  const state = findCol(data, /^SG_UF$/i) || (data as unknown as { state?: string }).state || "";
  const city = findCol(data, /^NM_UE$/i) || (data as unknown as { city?: string }).city || "";
  const yearStr = data._year ?? findCol(data, /^ANO_ELEICAO$/i);
  const electionYear = parseInt(String(yearStr)) || null;

  const resultStr = findCol(data, /DS_SIT_TOT_TURNO/i).toUpperCase();
  const elected = resultStr.includes("ELEITO") && !resultStr.includes("NÃO ELEITO") && !resultStr.includes("NAO ELEITO");

  return {
    rawId,
    cpf,
    name,
    ballotName: ballotName || null,
    party: party || null,
    position,
    state: state || null,
    city: city || null,
    electionYear,
    elected,
    birthDate: parseBrDate(findCol(data, /^DT_NASCIMENTO$/i)),
    birthState: findCol(data, /^SG_UF_NASCIMENTO$/i) || null,
    birthCity: findCol(data, /^NM_MUNICIPIO_NASCIMENTO$/i) || null,
    gender: findCol(data, /^DS_GENERO$/i) || null,
    education: findCol(data, /^DS_GRAU_INSTRUCAO$/i) || null,
    maritalStatus: findCol(data, /^DS_ESTADO_CIVIL$/i) || null,
    occupation: findCol(data, /^DS_OCUPACAO$/i) || null,
    email: findCol(data, /^NM_EMAIL$/i) || null,
  };
}

export async function processPoliticians() {
  return runJob("process-politicians", "processing", async () => {
    const rawRecords = await prisma.rawRecord.findMany({
      where: {
        source: { in: ["TSE", "CAMARA", "SENADO"] },
        recordType: { in: ["candidate", "deputy", "senator"] },
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, source: true, recordType: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!rawRecords.length) return { recordsIn: 0, recordsOut: 0 };

    const successIds: string[] = [];
    const errors: { id: string; error: string }[] = [];

    const candidates: CandidateTuple[] = [];
    const deputies: { rawId: string; data: DeputyData }[] = [];
    const senators: { rawId: string; data: SenadorData }[] = [];

    for (const raw of rawRecords) {
      if (raw.recordType === "candidate") {
        const c = extractCandidate(raw.id, raw.data as unknown as RawRow);
        if (c) {
          candidates.push(c);
        } else {
          successIds.push(raw.id);
        }
      } else if (raw.recordType === "deputy") {
        deputies.push({ rawId: raw.id, data: raw.data as unknown as DeputyData });
      } else if (raw.recordType === "senator") {
        senators.push({ rawId: raw.id, data: raw.data as unknown as SenadorData });
      }
    }

    if (candidates.length > 0) {
      const seen = new Map<string, CandidateTuple>();
      for (const c of candidates) {
        seen.set(c.cpf, c);
      }
      const deduped = Array.from(seen.values());

      const CHUNK = 250;
      for (let i = 0; i < deduped.length; i += CHUNK) {
        const chunk = deduped.slice(i, i + CHUNK);
        const params: unknown[] = [];
        const placeholders: string[] = [];

        for (const c of chunk) {
          const base = params.length;
          const p = (n: number) => `$${base + n}`;

          params.push(
            randomUUID(), c.cpf, c.name, c.ballotName, c.party, c.position,
            c.state, c.city, c.electionYear,
            c.elected, false,
            c.birthDate, c.birthState, c.birthCity,
            c.gender, c.education, c.maritalStatus, c.occupation, c.email,
            c.rawId, new Date(), new Date()
          );

          placeholders.push(`(
            ${p(1)}, ${p(2)}, ${p(3)}, ${p(4)}, ${p(5)}, ${p(6)},
            ${p(7)}, ${p(8)}, ${p(9)},
            ${p(10)}, ${p(11)},
            ${p(12)}::timestamp(3), ${p(13)}, ${p(14)},
            ${p(15)}, ${p(16)}, ${p(17)}, ${p(18)}, ${p(19)},
            ${p(20)},
            ${p(21)}::timestamp(3), ${p(22)}::timestamp(3)
          )`);
        }

        const sql = `
          INSERT INTO politicians (
            "id", "cpf", "name", "ballotName", "party", "position",
            "state", "city", "electionYear",
            "elected", "active",
            "birthDate", "birthState", "birthCity",
            "gender", "education", "maritalStatus", "occupation", "email",
            "rawRecordId",
            "createdAt", "updatedAt"
          )
          VALUES ${placeholders.join(", ")}
          ON CONFLICT ("cpf") DO UPDATE SET
            "name" = CASE WHEN EXCLUDED."name" != '' THEN EXCLUDED."name" ELSE politicians."name" END,
            "ballotName" = COALESCE(EXCLUDED."ballotName", politicians."ballotName"),
            "party" = COALESCE(EXCLUDED."party", politicians."party"),
            "position" = CASE WHEN EXCLUDED."position" != '' THEN EXCLUDED."position" ELSE politicians."position" END,
            "state" = COALESCE(EXCLUDED."state", politicians."state"),
            "city" = COALESCE(EXCLUDED."city", politicians."city"),
            "electionYear" = COALESCE(EXCLUDED."electionYear", politicians."electionYear"),
            "elected" = EXCLUDED."elected",
            "birthDate" = COALESCE(EXCLUDED."birthDate", politicians."birthDate"),
            "birthState" = COALESCE(EXCLUDED."birthState", politicians."birthState"),
            "birthCity" = COALESCE(EXCLUDED."birthCity", politicians."birthCity"),
            "gender" = COALESCE(EXCLUDED."gender", politicians."gender"),
            "education" = COALESCE(EXCLUDED."education", politicians."education"),
            "maritalStatus" = COALESCE(EXCLUDED."maritalStatus", politicians."maritalStatus"),
            "occupation" = COALESCE(EXCLUDED."occupation", politicians."occupation"),
            "email" = COALESCE(EXCLUDED."email", politicians."email"),
            "rawRecordId" = EXCLUDED."rawRecordId",
            "updatedAt" = NOW()::timestamp(3)
        `;

        try {
          await withDeadlockRetry(
            () => prisma.$executeRawUnsafe(sql, ...params),
            3,
            "process-politicians",
          );
        } catch (err) {
          console.error("[process-politicians] Bulk candidate insert failed:", err instanceof Error ? err.message : err);
          for (const c of chunk) {
            errors.push({ id: c.rawId, error: err instanceof Error ? err.message : "Bulk insert error" });
          }
        }
      }

      const rawIdsThatSucceeded = candidates
        .filter((c) => !errors.some((e) => e.id === c.rawId))
        .map((c) => c.rawId);
      successIds.push(...rawIdsThatSucceeded);
    }

    for (const { rawId, data } of deputies) {
      try {
        const cpf = (data.cpf ?? "").replace(/\D/g, "").padStart(11, "0");
        if (cpf.length !== 11 || cpf === "00000000000") {
          successIds.push(rawId);
          continue;
        }
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
        successIds.push(rawId);
      } catch (err) {
        errors.push({ id: rawId, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    for (const { rawId, data } of senators) {
      try {
        await processSenatorRecord(rawId, data);
        successIds.push(rawId);
      } catch (err) {
        errors.push({ id: rawId, error: err instanceof Error ? err.message : "Unknown error" });
      }
    }

    await markProcessed(successIds);
    await markErrors(errors);
    invalidatePoliticianCache();

    return { recordsIn: rawRecords.length, recordsOut: successIds.length };
  });
}

async function processSenatorRecord(rawId: string, data: SenadorData) {
  const name = data.nomeCompleto || data.nome;
  if (!name) return;

  const birthDate = data.dataNascimento ? new Date(data.dataNascimento) : null;

  const existing = await prisma.politician.findFirst({
    where: {
      name: { contains: data.nome, mode: "insensitive" },
      position: { in: ["Senador", "SENADOR"] },
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.politician.update({
      where: { id: existing.id },
      data: {
        ballotName: data.nome, party: data.partido, position: "Senador",
        state: data.uf, active: true, elected: true, photoUrl: data.photoUrl,
        email: data.email, externalId: `senado-${data.codigoParlamentar}`,
        gender: data.sexo ?? undefined, birthDate: birthDate ?? undefined,
        birthState: data.ufNaturalidade ?? undefined, birthCity: data.naturalidade ?? undefined,
        rawRecordId: rawId,
      },
    });
    return;
  }

  const tseMatch = await prisma.politician.findFirst({
    where: { name: { contains: data.nome, mode: "insensitive" }, state: data.uf },
    select: { id: true },
  });

  if (tseMatch) {
    await prisma.politician.update({
      where: { id: tseMatch.id },
      data: {
        ballotName: data.nome, party: data.partido, position: "Senador",
        active: true, elected: true, photoUrl: data.photoUrl, email: data.email,
        externalId: `senado-${data.codigoParlamentar}`,
        gender: data.sexo ?? undefined, birthDate: birthDate ?? undefined,
        birthState: data.ufNaturalidade ?? undefined, birthCity: data.naturalidade ?? undefined,
        rawRecordId: rawId,
      },
    });
    return;
  }

  const placeholderCpf = `SEN${data.codigoParlamentar.padStart(8, "0")}`;
  await prisma.politician.upsert({
    where: { cpf: placeholderCpf },
    create: {
      cpf: placeholderCpf, name, ballotName: data.nome, party: data.partido,
      position: "Senador", state: data.uf, active: true, elected: true,
      photoUrl: data.photoUrl, email: data.email, externalId: `senado-${data.codigoParlamentar}`,
      gender: data.sexo, birthDate, birthState: data.ufNaturalidade, birthCity: data.naturalidade,
      rawRecordId: rawId,
    },
    update: {
      party: data.partido, state: data.uf, active: true, photoUrl: data.photoUrl,
      email: data.email, gender: data.sexo ?? undefined, birthDate: birthDate ?? undefined,
      rawRecordId: rawId,
    },
  });
}
