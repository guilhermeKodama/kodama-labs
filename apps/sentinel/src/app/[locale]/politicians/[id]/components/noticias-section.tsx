import { prisma } from "@sentinel/server/lib/prisma";
import { EmptyState } from "@/components/empty-state";
import { InfoNote } from "@/components/info-note";
import { Newspaper, ExternalLink } from "lucide-react";
import { formatDate, type AppLocale } from "@/lib/utils";

const credibilityStyle: Record<string, string> = {
  TRUSTED: "bg-green-500/20 text-green-600",
  MIXED: "bg-yellow-500/20 text-yellow-600",
  LOW: "bg-orange-500/20 text-orange-600",
  UNKNOWN: "bg-muted text-muted-foreground",
};

/**
 * Notícias tab — external coverage linked to the politician so voters can
 * recall the record. Strictly "external source, not verified by Sentinel".
 * Data lands in M6; the fake-news/fact-check filter is a later analyze step.
 */
export async function NoticiasSection({
  politicianId,
  locale,
}: {
  politicianId: string;
  locale: AppLocale;
}) {
  const news = await prisma.politicianNews.findMany({
    where: { politicianId },
    orderBy: { publishedAt: "desc" },
    take: 50,
  });

  return (
    <div className="space-y-4">
      <InfoNote>
        Notícias de fontes externas, ligadas automaticamente a este nome.{" "}
        <strong>Não verificado pelo Sentinel</strong> — confira sempre no
        veículo original. A checagem de desinformação será adicionada
        futuramente.
      </InfoNote>

      {news.length === 0 ? (
        <EmptyState
          icon={<Newspaper className="h-5 w-5" />}
          title="Nenhuma notícia vinculada ainda"
          subtitle="A coleta de notícias por veículos da allowlist aparecerá aqui quando processada."
        />
      ) : (
        <div className="rounded-lg border bg-card divide-y overflow-hidden">
          {news.map((n) => (
            <a
              key={n.id}
              href={n.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-start justify-between gap-3 p-4 hover:bg-muted/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">{n.title}</p>
                <div className="text-[11px] text-muted-foreground mt-1 flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{n.source}</span>
                  {n.publishedAt && (
                    <span>· {formatDate(n.publishedAt, locale)}</span>
                  )}
                  {n.credibility && (
                    <span
                      className={`px-1.5 py-0.5 rounded font-medium ${
                        credibilityStyle[n.credibility] ??
                        credibilityStyle.UNKNOWN
                      }`}
                    >
                      {n.credibility}
                    </span>
                  )}
                  {n.factCheckStatus !== "UNVERIFIED" && (
                    <span className="px-1.5 py-0.5 rounded bg-muted font-medium">
                      {n.factCheckStatus}
                    </span>
                  )}
                </div>
              </div>
              <ExternalLink className="h-4 w-4 flex-shrink-0 text-muted-foreground mt-0.5" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
