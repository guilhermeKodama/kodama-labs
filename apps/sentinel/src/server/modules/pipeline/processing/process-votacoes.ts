import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import { getExternalIdToPoliticianId } from "@sentinel/server/lib/politician-cache";

const BATCH_SIZE = 30;

interface RawVotacaoData {
  votacao?: {
    id?: string;
    date?: string | null;
    description?: string | null;
  };
  votos?: { deputyId: number; vote: string }[];
  orientacoes?: { partyBloc: string; orientation: string }[];
  _empty?: boolean;
}

/** Normalizes Câmara tipoVoto strings to stable vote-direction codes. */
export function normalizeVote(tipo: string): string {
  const t = tipo.toLowerCase();
  if (t.includes("sim")) return "SIM";
  if (t.includes("não") || t.includes("nao")) return "NAO";
  if (t.includes("absten")) return "ABSTENCAO";
  if (t.includes("obstru")) return "OBSTRUCAO";
  if (t.includes("artigo 17")) return "ART17";
  return "OUTRO";
}

/**
 * Explodes votação RawRecords into LegislativeVote rows, attributing each vote
 * to its politician and tagging the government's orientation (for gov_alignment).
 */
export async function processVotacoes() {
  return runJob("process-votacoes", "processing", async () => {
    const raws = await prisma.rawRecord.findMany({
      where: {
        source: "CAMARA_LEGISLATIVE",
        recordType: "votacao",
        processedAt: null,
        processingError: null,
      },
      select: { id: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!raws.length) return { recordsIn: 0, recordsOut: 0 };

    const extMap = await getExternalIdToPoliticianId();
    const successIds: string[] = [];
    const errs: { id: string; error: string }[] = [];
    const toCreate: Prisma.LegislativeVoteCreateManyInput[] = [];

    for (const raw of raws) {
      const data = raw.data as unknown as RawVotacaoData;
      if (!data || data._empty || !Array.isArray(data.votos) || !data.votos.length) {
        successIds.push(raw.id);
        continue;
      }

      const votacaoId = String(data.votacao?.id ?? "");
      if (!votacaoId) {
        successIds.push(raw.id);
        continue;
      }

      // Government orientation (siglaPartidoBloco "GOV.") → SIM/NAO.
      let orientationGov: string | null = null;
      if (Array.isArray(data.orientacoes)) {
        const gov = data.orientacoes.find((o) =>
          (o.partyBloc ?? "").toUpperCase().includes("GOV"),
        );
        if (gov) {
          const n = normalizeVote(gov.orientation ?? "");
          orientationGov = n === "SIM" || n === "NAO" ? n : null;
        }
      }

      const date = data.votacao?.date ? new Date(data.votacao.date) : null;
      const title = data.votacao?.description ?? null;

      for (const voto of data.votos) {
        const politicianId = extMap.get(String(voto.deputyId));
        if (!politicianId) continue;
        toCreate.push({
          politicianId,
          votacaoId,
          house: "CAMARA",
          vote: normalizeVote(voto.vote ?? ""),
          votacaoDate: date,
          votacaoTitle: title,
          orientationGov,
          rawRecordId: raw.id,
        });
      }
      successIds.push(raw.id);
    }

    if (toCreate.length > 0) {
      const CHUNK = 1000;
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        try {
          await prisma.legislativeVote.createMany({
            data: toCreate.slice(i, i + CHUNK),
            skipDuplicates: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "createMany error";
          console.error("[process-votacoes] createMany failed:", msg);
          const failedRawIds = new Set(
            toCreate.slice(i, i + CHUNK).map((r) => r.rawRecordId!),
          );
          for (const rid of failedRawIds) {
            const idx = successIds.indexOf(rid);
            if (idx !== -1) successIds.splice(idx, 1);
            errs.push({ id: rid, error: msg });
          }
        }
      }
    }

    await markProcessed(successIds);
    await markErrors(errs);

    return { recordsIn: raws.length, recordsOut: successIds.length };
  });
}
