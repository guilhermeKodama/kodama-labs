import { prisma } from "@sentinel/server/lib/prisma";
import { setRequestLocale } from "next-intl/server";
import { PageLayout } from "@/components/page-layout";
import { stripHtml } from "@/lib/utils";
import Link from "next/link";
import { FileText } from "lucide-react";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const analyses = await prisma.aiAnalysis.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { procurement: { select: { id: true, description: true, orgName: true } } },
  });

  return (
    <PageLayout>
      <h1 className="text-2xl font-bold mb-5">Análise IA</h1>

      {analyses.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            Nenhuma análise de IA encontrada. O sistema executará análises
            automaticamente quando houver dados processados.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {analyses.map((analysis) => (
            <div key={analysis.id} className="rounded-lg border bg-card p-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-[11px] px-2 py-0.5 rounded bg-muted font-medium">
                    {analysis.analysisType}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-muted font-medium">
                    {analysis.targetType}
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium ${
                    analysis.riskScore >= 0.7
                      ? "bg-red-500/20 text-red-500"
                      : analysis.riskScore >= 0.4
                        ? "bg-yellow-500/20 text-yellow-500"
                        : "bg-green-500/20 text-green-500"
                  }`}>
                    Risco: {(analysis.riskScore * 100).toFixed(0)}%
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground">
                  {analysis.createdAt.toLocaleDateString("pt-BR")}
                </span>
              </div>

              {analysis.procurement && (
                <Link
                  href={`/${locale}/procurements/${analysis.procurement.id}`}
                  className="flex items-center gap-2 mb-3 p-2 -mx-2 rounded hover:bg-muted/50 transition-colors"
                >
                  <FileText className="h-4 w-4 text-purple-500 flex-shrink-0" />
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{stripHtml(analysis.procurement.description)}</p>
                    <p className="text-xs text-muted-foreground">{analysis.procurement.orgName}</p>
                  </div>
                </Link>
              )}

              <p className="text-sm whitespace-pre-wrap leading-relaxed text-muted-foreground">
                {analysis.response.slice(0, 800)}
                {analysis.response.length > 800 && "..."}
              </p>

              {analysis.procurement && (
                <div className="mt-3 pt-3 border-t">
                  <Link
                    href={`/${locale}/procurements/${analysis.procurement.id}`}
                    className="text-xs text-primary hover:underline"
                  >
                    Ver licitação completa →
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </PageLayout>
  );
}
