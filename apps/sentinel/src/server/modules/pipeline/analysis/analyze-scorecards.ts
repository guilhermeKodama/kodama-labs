import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";

const ELECTION_YEAR = 2026;

interface VoteStat {
  politicianId: string;
  voted: bigint;
  comparable: bigint;
  agreed: bigint;
}

/**
 * Computes decision-support scorecards from legislative votes:
 * - attendance_rate: share of the chamber's roll-calls the politician voted in.
 * - gov_alignment: how often they voted with the government's orientation
 *   ("Basômetro"-style), among comparable SIM/NAO votes.
 * - coherence_stance: declared stance ("discurso") vs key-vote behavior ("ação").
 * Idempotent per (politicianId, electionYear, metric).
 */
export async function analyzeScorecards() {
  return runJob("analyze-scorecards", "analysis", async () => {
    const totalRow = await prisma.$queryRaw<{ total: bigint }[]>`
      SELECT COUNT(DISTINCT "votacaoId")::bigint as total
      FROM legislative_votes WHERE house = 'CAMARA'
    `;
    const totalVotacoes = Number(totalRow[0]?.total ?? 0);

    const stats = await prisma.$queryRaw<VoteStat[]>`
      SELECT "politicianId",
        COUNT(DISTINCT "votacaoId")::bigint AS voted,
        COUNT(*) FILTER (
          WHERE "orientationGov" IN ('SIM','NAO') AND vote IN ('SIM','NAO')
        )::bigint AS comparable,
        COUNT(*) FILTER (
          WHERE "orientationGov" IN ('SIM','NAO') AND vote IN ('SIM','NAO')
            AND vote = "orientationGov"
        )::bigint AS agreed
      FROM legislative_votes
      WHERE house = 'CAMARA'
      GROUP BY "politicianId"
    `;

    const ops: Prisma.PrismaPromise<unknown>[] = [];
    for (const s of stats) {
      const voted = Number(s.voted);
      const comparable = Number(s.comparable);
      const agreed = Number(s.agreed);

      if (totalVotacoes > 0) {
        const attendance = Math.min(100, (voted / totalVotacoes) * 100);
        ops.push(
          upsertScorecard(s.politicianId, "attendance_rate", attendance, {
            voted,
            totalVotacoes,
          }),
        );
      }
      if (comparable > 0) {
        const govAlignment = (agreed / comparable) * 100;
        ops.push(
          upsertScorecard(s.politicianId, "gov_alignment", govAlignment, {
            agreed,
            comparable,
          }),
        );
      }
    }

    // --- Coherence: declared stance ("discurso") vs key-vote behavior ("ação") ---
    const [keyVotes, stances] = await Promise.all([
      prisma.keyVote.findMany({
        where: { votacaoExternalId: { not: null } },
        select: { theme: true, votacaoExternalId: true, favorableVote: true },
      }),
      prisma.policyStance.findMany({
        select: { politicianId: true, theme: true, stance: true },
      }),
    ]);

    if (keyVotes.length > 0 && stances.length > 0) {
      const byTheme = new Map<string, { votacaoId: string; favorableVote: string }[]>();
      for (const kv of keyVotes) {
        if (!kv.votacaoExternalId) continue;
        const arr = byTheme.get(kv.theme) ?? [];
        arr.push({ votacaoId: kv.votacaoExternalId, favorableVote: kv.favorableVote });
        byTheme.set(kv.theme, arr);
      }

      const allVotacaoIds = keyVotes
        .map((k) => k.votacaoExternalId)
        .filter((id): id is string => Boolean(id));
      const stancePoliticianIds = [...new Set(stances.map((s) => s.politicianId))];

      const votes = await prisma.legislativeVote.findMany({
        where: {
          politicianId: { in: stancePoliticianIds },
          votacaoId: { in: allVotacaoIds },
        },
        select: { politicianId: true, votacaoId: true, vote: true },
      });
      const voteMap = new Map<string, string>();
      for (const v of votes) voteMap.set(`${v.politicianId}|${v.votacaoId}`, v.vote);

      const stancesByPol = new Map<string, { theme: string; stance: string }[]>();
      for (const s of stances) {
        const arr = stancesByPol.get(s.politicianId) ?? [];
        arr.push({ theme: s.theme, stance: s.stance });
        stancesByPol.set(s.politicianId, arr);
      }

      for (const [politicianId, polStances] of stancesByPol) {
        let themesEvaluated = 0;
        let coherent = 0;
        const detail: Record<string, string> = {};
        for (const ps of polStances) {
          if (ps.stance !== "FAVOR" && ps.stance !== "CONTRA") continue;
          let votedFavor = 0;
          let votedAgainst = 0;
          for (const kv of byTheme.get(ps.theme) ?? []) {
            const v = voteMap.get(`${politicianId}|${kv.votacaoId}`);
            if (!v || (v !== "SIM" && v !== "NAO")) continue;
            if (v === kv.favorableVote) votedFavor++;
            else votedAgainst++;
          }
          if (votedFavor + votedAgainst === 0) continue;
          const actedFavor = votedFavor >= votedAgainst;
          const declaredFavor = ps.stance === "FAVOR";
          themesEvaluated++;
          if (actedFavor === declaredFavor) {
            coherent++;
            detail[ps.theme] = "coerente";
          } else {
            detail[ps.theme] = "divergente";
          }
        }
        if (themesEvaluated > 0) {
          ops.push(
            upsertScorecard(
              politicianId,
              "coherence_stance",
              (coherent / themesEvaluated) * 100,
              { themesEvaluated, coherent, byTheme: detail },
            ),
          );
        }
      }
    }

    const CHUNK = 200;
    for (let i = 0; i < ops.length; i += CHUNK) {
      await prisma.$transaction(ops.slice(i, i + CHUNK));
    }

    return {
      recordsIn: stats.length,
      recordsOut: ops.length,
      metadata: { totalVotacoes },
    };
  });
}

function upsertScorecard(
  politicianId: string,
  metric: string,
  valueNum: number,
  details: Prisma.InputJsonValue,
): Prisma.PrismaPromise<unknown> {
  return prisma.politicianScorecard.upsert({
    where: {
      politicianId_electionYear_metric: {
        politicianId,
        electionYear: ELECTION_YEAR,
        metric,
      },
    },
    create: {
      politicianId,
      electionYear: ELECTION_YEAR,
      metric,
      valueNum,
      details,
    },
    update: { valueNum, details, computedAt: new Date() },
  });
}
