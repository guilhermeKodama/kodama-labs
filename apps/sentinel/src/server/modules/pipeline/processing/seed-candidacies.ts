import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";

const ELECTION_YEAR = 2026;
const BATCH = 500;

/**
 * Seeds 2026 Candidacy rows for current office-holders (active = true) so the
 * Eleições 2026 page has data before the official TSE registry opens
 * (~mid-Aug 2026). Idempotent on (politicianId, electionYear): existing rows
 * are left untouched, so when TSE 2026 lands and process-politicians upgrades a
 * row to status OFFICIAL, this seed never clobbers it.
 */
export async function seedCandidacies() {
  return runJob("seed-candidacies", "processing", async () => {
    const politicians = await prisma.politician.findMany({
      where: { active: true },
      select: { id: true, position: true, state: true, party: true },
    });

    if (!politicians.length) return { recordsIn: 0, recordsOut: 0 };

    let upserts = 0;
    for (let i = 0; i < politicians.length; i += BATCH) {
      const chunk = politicians.slice(i, i + BATCH);
      await prisma.$transaction(
        chunk.map((p) => {
          const source = p.position?.toLowerCase().includes("senador")
            ? "SENADO"
            : "CAMARA";
          return prisma.candidacy.upsert({
            where: {
              politicianId_electionYear: {
                politicianId: p.id,
                electionYear: ELECTION_YEAR,
              },
            },
            create: {
              politicianId: p.id,
              electionYear: ELECTION_YEAR,
              position: p.position,
              state: p.state,
              party: p.party,
              status: "INCUMBENT",
              source,
            },
            // Never overwrite an existing row (may already be OFFICIAL from TSE).
            update: {},
          });
        }),
      );
      upserts += chunk.length;
    }

    return {
      recordsIn: politicians.length,
      recordsOut: upserts,
      metadata: { electionYear: ELECTION_YEAR },
    };
  });
}
