import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { getCpfToPoliticianId } from "@sentinel/server/lib/politician-cache";
import stancesConfig from "./data/policy-stances.json";

interface StanceConfig {
  cpf: string;
  theme: string;
  stance: string;
  sourceUrl?: string;
  verifiedBy?: string;
}

/**
 * Loads curated declared positions ("discurso") into PolicyStance, always as
 * source CURATED (non-official, labeled in the UI). Compared against actual
 * key-vote behavior by analyze-scorecards to produce coherence_stance.
 */
export async function loadStances() {
  return runJob("load-stances", "processing", async () => {
    const stances = (stancesConfig.stances ?? []) as StanceConfig[];
    const cpfMap = await getCpfToPoliticianId();

    let out = 0;
    let skipped = 0;
    for (const s of stances) {
      const cpf = (s.cpf ?? "").replace(/\D/g, "");
      const politicianId = cpfMap.get(cpf);
      if (!politicianId || (s.stance !== "FAVOR" && s.stance !== "CONTRA" && s.stance !== "NEUTRO")) {
        skipped++;
        continue;
      }
      await prisma.policyStance.upsert({
        where: {
          politicianId_theme_source: {
            politicianId,
            theme: s.theme,
            source: "CURATED",
          },
        },
        create: {
          politicianId,
          theme: s.theme,
          stance: s.stance,
          source: "CURATED",
          verifiedBy: s.verifiedBy ?? "manual",
          sourceUrl: s.sourceUrl ?? null,
        },
        update: {
          stance: s.stance,
          verifiedBy: s.verifiedBy ?? "manual",
          sourceUrl: s.sourceUrl ?? null,
        },
      });
      out++;
    }

    return { recordsIn: stances.length, recordsOut: out, metadata: { skipped } };
  });
}
