import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import { getExternalIdToPoliticianId } from "@sentinel/server/lib/politician-cache";

const BATCH_SIZE = 25;

interface RawProposicao {
  id: number;
  type: string;
  number: number | null;
  year: number | null;
  summary: string;
}

/**
 * Upserts authored bills (LegislativeProposal) + their authorship link
 * (BillAuthorship). Two-phase bulk: createMany the proposals, look up their
 * ids, then createMany the authorships — avoids per-row upsert storms.
 */
export async function processProposicoes() {
  return runJob("process-proposicoes", "processing", async () => {
    const raws = await prisma.rawRecord.findMany({
      where: {
        source: "CAMARA_LEGISLATIVE",
        recordType: "proposicoes",
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!raws.length) return { recordsIn: 0, recordsOut: 0 };

    const extMap = await getExternalIdToPoliticianId();
    const successIds: string[] = [];
    const errs: { id: string; error: string }[] = [];

    const proposalByKey = new Map<string, Prisma.LegislativeProposalCreateManyInput>();
    const authIntents: { externalId: string; politicianId: string }[] = [];

    for (const raw of raws) {
      const politicianId = extMap.get(raw.externalId);
      if (!politicianId) {
        errs.push({ id: raw.id, error: `No politician for deputy ${raw.externalId}` });
        continue;
      }
      const data = raw.data as unknown;
      if (!Array.isArray(data)) {
        successIds.push(raw.id); // { _empty: true }
        continue;
      }
      for (const p of data as RawProposicao[]) {
        const externalId = String(p.id);
        if (!proposalByKey.has(externalId)) {
          proposalByKey.set(externalId, {
            house: "CAMARA",
            externalId,
            type: p.type ?? "",
            number: p.number ?? null,
            year: p.year ?? null,
            title: p.summary ?? "",
            themes: [],
          });
        }
        authIntents.push({ externalId, politicianId });
      }
      successIds.push(raw.id);
    }

    try {
      if (proposalByKey.size > 0) {
        await prisma.legislativeProposal.createMany({
          data: [...proposalByKey.values()],
          skipDuplicates: true,
        });
      }

      const externalIds = [...proposalByKey.keys()];
      const proposals = externalIds.length
        ? await prisma.legislativeProposal.findMany({
            where: { house: "CAMARA", externalId: { in: externalIds } },
            select: { id: true, externalId: true },
          })
        : [];
      const idByExternal = new Map(proposals.map((p) => [p.externalId, p.id]));

      const authData = authIntents
        .map((a) => ({
          politicianId: a.politicianId,
          proposalId: idByExternal.get(a.externalId),
          role: "AUTHOR",
        }))
        .filter(
          (a): a is { politicianId: string; proposalId: string; role: string } =>
            Boolean(a.proposalId),
        );

      if (authData.length > 0) {
        await prisma.billAuthorship.createMany({
          data: authData,
          skipDuplicates: true,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "bulk upsert error";
      console.error("[process-proposicoes] failed:", msg);
      // Roll the whole batch back to unprocessed so it retries next pass.
      for (const raw of raws) errs.push({ id: raw.id, error: msg });
      await markErrors(errs);
      return { recordsIn: raws.length, recordsOut: 0 };
    }

    await markProcessed(successIds);
    await markErrors(errs);

    return { recordsIn: raws.length, recordsOut: proposalByKey.size };
  });
}
