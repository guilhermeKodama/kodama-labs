import { prisma } from "@sentinel/server/lib/prisma";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { InfoNote } from "@/components/info-note";
import { FileText, Vote, Scale } from "lucide-react";
import { formatDate, type AppLocale } from "@/lib/utils";

const voteStyle: Record<string, string> = {
  SIM: "bg-green-500/20 text-green-600",
  NAO: "bg-red-500/20 text-red-500",
  ABSTENCAO: "bg-yellow-500/20 text-yellow-600",
  OBSTRUCAO: "bg-orange-500/20 text-orange-600",
  AUSENTE: "bg-muted text-muted-foreground",
};

const ELECTION_YEAR = 2026;

/**
 * Atuação tab — what the politician defends in practice: key-vote positions
 * (discurso×ação), authored bills and roll-call votes. Data lands in M3/M4;
 * until then neutral empty states.
 */
export async function AtuacaoSection({
  politicianId,
  locale,
}: {
  politicianId: string;
  locale: AppLocale;
}) {
  const tTheme = await getTranslations("codes.theme");

  const [bills, votes, keyVotes, coherence] = await Promise.all([
    prisma.billAuthorship.findMany({
      where: { politicianId },
      include: { proposal: true },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.legislativeVote.findMany({
      where: { politicianId },
      orderBy: { votacaoDate: "desc" },
      take: 50,
    }),
    prisma.keyVote.findMany({
      where: { votacaoExternalId: { not: null } },
      orderBy: { theme: "asc" },
    }),
    prisma.politicianScorecard.findUnique({
      where: {
        politicianId_electionYear_metric: {
          politicianId,
          electionYear: ELECTION_YEAR,
          metric: "coherence_stance",
        },
      },
    }),
  ]);

  // The politician's vote on each key-vote (matched by votação id).
  const keyVotacaoIds = keyVotes
    .map((k) => k.votacaoExternalId)
    .filter((id): id is string => Boolean(id));
  const keyVoteVotes = keyVotacaoIds.length
    ? await prisma.legislativeVote.findMany({
        where: { politicianId, votacaoId: { in: keyVotacaoIds } },
        select: { votacaoId: true, vote: true },
      })
    : [];
  const kvVoteMap = new Map(keyVoteVotes.map((v) => [v.votacaoId, v.vote]));

  const theme = (code: string) => {
    try {
      return tTheme(code);
    } catch {
      return code;
    }
  };

  if (bills.length === 0 && votes.length === 0 && keyVotes.length === 0) {
    return (
      <EmptyState
        icon={<Vote className="h-5 w-5" />}
        title="Dados de atuação ainda não disponíveis"
        subtitle="Votações em pautas e projetos de autoria (dados abertos da Câmara/Senado) aparecerão aqui quando processados."
      />
    );
  }

  return (
    <div className="space-y-6">
      {coherence?.valueNum != null && (
        <InfoNote icon={<Scale className="h-4 w-4" />}>
          Coerência discurso × ação:{" "}
          <strong>{Math.round(coherence.valueNum)}%</strong> dos temas em que há
          posição declarada batem com o voto real. A posição declarada vem de
          curadoria (fonte não-oficial).
        </InfoNote>
      )}

      {/* Pautas-chave: how the politician voted on curated salient votes */}
      {keyVotes.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Scale className="h-4 w-4" />
              Pautas-chave ({keyVotes.length})
            </h2>
          </div>
          <div className="divide-y">
            {keyVotes.map((kv) => {
              const vote = kv.votacaoExternalId
                ? kvVoteMap.get(kv.votacaoExternalId)
                : undefined;
              const isFavorable =
                vote && (vote === "SIM" || vote === "NAO")
                  ? vote === kv.favorableVote
                  : null;
              return (
                <div key={kv.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1 flex-wrap">
                        <span className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          {theme(kv.theme)}
                        </span>
                      </div>
                      <p className="text-sm font-medium">{kv.label}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {kv.description}
                      </p>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {isFavorable === null ? (
                        <span className="text-[11px] text-muted-foreground">
                          {vote ?? "Sem registro"}
                        </span>
                      ) : isFavorable ? (
                        <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-green-500/20 text-green-600">
                          A favor da pauta
                        </span>
                      ) : (
                        <span className="text-[11px] px-1.5 py-0.5 rounded font-medium bg-red-500/20 text-red-500">
                          Contra a pauta
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {bills.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Projetos de Autoria ({bills.length})
            </h2>
          </div>
          <div className="divide-y">
            {bills.map((b) => (
              <div key={b.id} className="p-4">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-medium">
                    {b.proposal.type}
                    {b.proposal.number ? ` ${b.proposal.number}` : ""}
                    {b.proposal.year ? `/${b.proposal.year}` : ""}
                  </span>
                  {b.proposal.themes.slice(0, 3).map((t) => (
                    <span
                      key={t}
                      className="text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary"
                    >
                      {theme(t)}
                    </span>
                  ))}
                </div>
                <p className="text-sm">{b.proposal.title}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {votes.length > 0 && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold flex items-center gap-2">
              <Vote className="h-4 w-4" />
              Votações ({votes.length})
            </h2>
          </div>
          <div className="divide-y">
            {votes.map((v) => (
              <div
                key={v.id}
                className="flex items-start justify-between gap-3 p-4"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm">{v.votacaoTitle ?? v.votacaoId}</p>
                  {v.votacaoDate && (
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {formatDate(v.votacaoDate, locale)}
                    </p>
                  )}
                </div>
                <span
                  className={`flex-shrink-0 text-[11px] px-1.5 py-0.5 rounded font-medium ${
                    voteStyle[v.vote] ?? "bg-muted text-muted-foreground"
                  }`}
                >
                  {v.vote}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
