import { getTranslations, setRequestLocale } from "next-intl/server";

import { prisma } from "@pipeline/server/lib/prisma";
import type { LeadStatus, Prisma } from "@/generated/prisma";
import { LEAD_STATUSES, type LeadStatusValue } from "@/lib/funnel/lead-status";
import { LeadFilters } from "./filters";
import { LeadStatusSelect } from "./lead-row-actions";

export const dynamic = "force-dynamic"; // status mutations must be visible immediately

interface PageProps {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ idea?: string; status?: string; q?: string }>;
}

const PAGE_SIZE = 100;

export default async function LeadsPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const sp = await searchParams;
  const t = await getTranslations("leads");

  const statusFilter = LEAD_STATUSES.includes(sp.status as LeadStatusValue)
    ? (sp.status as LeadStatus)
    : undefined;

  const where: Prisma.LeadWhereInput = {
    ...(sp.idea ? { idea: { slug: sp.idea } } : {}),
    ...(statusFilter ? { status: statusFilter } : {}),
    ...(sp.q
      ? {
          OR: [
            { email: { contains: sp.q, mode: "insensitive" } },
            { contact: { contains: sp.q, mode: "insensitive" } },
            { name: { contains: sp.q, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [ideas, total, leads] = await Promise.all([
    prisma.idea.findMany({
      where: { status: { not: "ARCHIVED" } },
      select: { slug: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: { idea: { select: { slug: true, name: true } } },
      orderBy: { createdAt: "desc" },
      take: PAGE_SIZE,
    }),
  ]);

  const dateFmt = new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    timeZone: "America/Sao_Paulo",
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {t("subtitle", { total })}
        </p>
      </div>

      <LeadFilters ideas={ideas} />

      <div className="rounded-lg border bg-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="px-4 py-2.5 font-medium">{t("columns.lead")}</th>
              <th className="px-4 py-2.5 font-medium">{t("columns.idea")}</th>
              <th className="px-4 py-2.5 font-medium">{t("columns.channel")}</th>
              <th className="px-4 py-2.5 font-medium">{t("columns.campaign")}</th>
              <th className="px-4 py-2.5 font-medium">{t("columns.status")}</th>
              <th className="px-4 py-2.5 font-medium">{t("columns.created")}</th>
            </tr>
          </thead>
          <tbody>
            {leads.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-sm text-muted-foreground">
                  {t("empty")}
                </td>
              </tr>
            ) : null}
            {leads.map((lead) => (
              <tr key={lead.id} className="border-b last:border-0 align-top hover:bg-muted/40">
                <td className="px-4 py-2.5">
                  <details>
                    <summary className="cursor-pointer list-none">
                      <span className="font-medium">{lead.email}</span>
                      {lead.contact ? (
                        <span className="text-xs text-muted-foreground"> · {lead.contact}</span>
                      ) : null}
                    </summary>
                    <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {Object.entries(
                        (lead.formData ?? {}) as Record<string, unknown>,
                      ).map(([k, v]) => (
                        <p key={k}>
                          <span className="font-medium">{k}:</span>{" "}
                          {Array.isArray(v) ? v.join(", ") : String(v)}
                        </p>
                      ))}
                      {lead.utmContent ? <p>utm_content: {lead.utmContent}</p> : null}
                      {lead.gclid ? <p>gclid: {lead.gclid.slice(0, 18)}…</p> : null}
                      {lead.notes ? <p className="text-foreground">📝 {lead.notes}</p> : null}
                      {lead.resubmitCount > 0 ? (
                        <p>{t("resubmits", { count: lead.resubmitCount })}</p>
                      ) : null}
                    </div>
                  </details>
                </td>
                <td className="px-4 py-2.5 text-xs">{lead.idea.name}</td>
                <td className="px-4 py-2.5 text-xs">{lead.channel}</td>
                <td className="px-4 py-2.5 text-xs text-muted-foreground max-w-[180px] truncate">
                  {lead.utmCampaign || "—"}
                </td>
                <td className="px-4 py-2.5">
                  <LeadStatusSelect
                    leadId={lead.id}
                    status={lead.status as LeadStatusValue}
                  />
                </td>
                <td className="px-4 py-2.5 text-xs tabular-nums whitespace-nowrap">
                  {dateFmt.format(lead.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {total > PAGE_SIZE ? (
        <p className="text-xs text-muted-foreground">
          {t("showingFirst", { shown: PAGE_SIZE, total })}
        </p>
      ) : null}
    </div>
  );
}
