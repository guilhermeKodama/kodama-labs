import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import keyVotesConfig from "./data/key-votes.json";

interface KeyVoteConfig {
  slug: string;
  theme: string;
  label: string;
  description: string;
  house: string;
  votacaoExternalId: string;
  favorableVote: string;
}

/**
 * Loads the curated key-votes config (pautas-chave) into the KeyVote table.
 * Editorial: votacaoExternalId is filled with the real Câmara votação id so
 * the pauta lights up in each politician's "Pautas-chave" block.
 */
export async function loadKeyVotes() {
  return runJob("load-key-votes", "processing", async () => {
    const kvs = (keyVotesConfig.keyVotes ?? []) as KeyVoteConfig[];
    let out = 0;
    for (const kv of kvs) {
      if (!kv.slug) continue;
      const fields = {
        theme: kv.theme,
        label: kv.label,
        description: kv.description,
        house: kv.house,
        votacaoExternalId: kv.votacaoExternalId || null,
        favorableVote: kv.favorableVote,
      };
      await prisma.keyVote.upsert({
        where: { slug: kv.slug },
        create: { slug: kv.slug, ...fields },
        update: fields,
      });
      out++;
    }
    return { recordsIn: kvs.length, recordsOut: out };
  });
}
