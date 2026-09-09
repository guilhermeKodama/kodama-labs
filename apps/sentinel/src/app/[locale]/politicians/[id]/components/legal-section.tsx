import { prisma } from "@sentinel/server/lib/prisma";
import { getTranslations } from "next-intl/server";
import { EmptyState } from "@/components/empty-state";
import { InfoNote } from "@/components/info-note";
import { Scale } from "lucide-react";
import { formatDate, type AppLocale } from "@/lib/utils";

function tr(t: (key: string) => string, code: string): string {
  try {
    return t(code);
  } catch {
    return code;
  }
}

/**
 * Histórico Legal tab. Public-record framing (never a verdict). Data lands in
 * M5 (TSE inelegibility + TCU rejected accounts); until then a neutral empty
 * state. The proceedings list is already wired so it lights up automatically.
 */
export async function LegalSection({
  politicianId,
  locale,
}: {
  politicianId: string;
  locale: AppLocale;
}) {
  const [proceedings, tKind, tStatus] = await Promise.all([
    prisma.legalProceeding.findMany({
      where: { politicianId },
      orderBy: [{ decisionDate: "desc" }, { createdAt: "desc" }],
    }),
    getTranslations("codes.proceedingKind"),
    getTranslations("codes.proceedingStatus"),
  ]);

  return (
    <div className="space-y-4">
      <InfoNote>
        Reúne registros públicos de fontes oficiais (TSE, TCU e tribunais). É
        material para verificação — não constitui afirmação de culpa. Cada item
        traz a fonte e o estágio do processo.
      </InfoNote>

      {proceedings.length === 0 ? (
        <EmptyState
          icon={<Scale className="h-5 w-5" />}
          title="Nenhum registro legal disponível ainda"
          subtitle="Inelegibilidade (TSE) e contas julgadas (TCU) aparecerão aqui quando processadas."
        />
      ) : (
        <div className="rounded-lg border bg-card divide-y overflow-hidden">
          {proceedings.map((p) => (
            <div key={p.id} className="p-4">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted font-medium">
                  {tr(tKind, p.kind)}
                </span>
                <span className="text-[11px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                  {tr(tStatus, p.status)}
                </span>
                {p.makesIneligible && (
                  <span className="text-[11px] px-1.5 py-0.5 rounded bg-red-500/20 text-red-500 font-medium">
                    Inelegibilidade registrada
                  </span>
                )}
                {p.source === "CURATED" && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-600 font-medium">
                    Fonte não-oficial
                  </span>
                )}
              </div>
              <p className="text-sm font-medium">{p.title}</p>
              {p.description && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {p.description}
                </p>
              )}
              <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                {p.court && <span>{p.court}</span>}
                {p.decisionDate && (
                  <span>· {formatDate(p.decisionDate, locale)}</span>
                )}
                {p.sourceUrl && (
                  <a
                    href={p.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary hover:underline"
                  >
                    · fonte
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
