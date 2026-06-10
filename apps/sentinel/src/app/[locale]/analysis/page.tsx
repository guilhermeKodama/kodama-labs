import { prisma } from "@sentinel/server/lib/prisma";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { stripHtml, formatDate, type AppLocale } from "@/lib/utils";
import Link from "next/link";
import { FileText } from "lucide-react";

export default async function AnalysisPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations("pages.analysis");
  const tCommon = await getTranslations("common");
  const tCodes = await getTranslations("codes");
  const appLocale = locale as AppLocale;

  const analyses = await prisma.aiAnalysis.findMany({
    orderBy: { createdAt: "desc" },
    take: 20,
    include: { procurement: { select: { id: true, description: true, orgName: true } } },
  });

  const renderCode = (group: string, code: string): string => {
    const key = `${group}.${code}`;
    const v = tCodes(key);
    return v === key ? code : v;
  };

  return (
    <>
      <h1 className="text-xl md:text-2xl font-bold mb-2">{t("title")}</h1>
      <p className="text-xs text-muted-foreground mb-5 max-w-3xl">
        {tCommon("disclaimer")}
      </p>

      {analyses.length === 0 ? (
        <div className="rounded-lg border bg-card p-12 text-center">
          <p className="text-muted-foreground">
            {t("empty")}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {analyses.map((analysis) => (
            <div key={analysis.id} className="rounded-lg border bg-card p-4 md:p-5 min-w-0">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 mb-3">
                <div className="flex flex-wrap items-center gap-2 min-w-0">
                  <span className="text-[11px] px-2 py-0.5 rounded bg-muted font-medium truncate max-w-full">
                    {renderCode("aiAnalysisType", analysis.analysisType)}
                  </span>
                  <span className="text-[11px] px-2 py-0.5 rounded bg-muted font-medium truncate max-w-full">
                    {renderCode("aiTargetType", analysis.targetType)}
                  </span>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
                    analysis.riskScore >= 0.7
                      ? "bg-red-500/20 text-red-500"
                      : analysis.riskScore >= 0.4
                        ? "bg-yellow-500/20 text-yellow-500"
                        : "bg-green-500/20 text-green-500"
                  }`}>
                    {t("riskLabel", { percent: (analysis.riskScore * 100).toFixed(0) })}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground ml-auto whitespace-nowrap">
                  {formatDate(analysis.createdAt, appLocale)}
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
                    {t("viewProcurement")}
                  </Link>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
