import Link from "next/link";
import { notFound } from "next/navigation";
import { getCompanyDetail } from "@/server/modules/companies/queries";
import { STATUS_LABELS } from "@/server/modules/jobs/queries";
import { NotesSection } from "@/components/notes-section";
import { ArrowLeft, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

const HEALTH_LABEL: Record<string, string> = {
  FORTE: "saúde forte",
  ATENCAO: "saúde em atenção",
  RISCO: "saúde em risco",
  A_CONFIRMAR: "saúde a confirmar",
};

export default async function CompanyDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const company = await getCompanyDetail(slug);
  if (!company) notFound();

  const openJobs = company.jobs.filter((j) => j.status !== "DESCARTADA");
  const discardedJobs = company.jobs.filter((j) => j.status === "DESCARTADA");

  return (
    <div className="flex h-full flex-col overflow-auto">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Link href="/empresas" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <span className="text-xs text-muted-foreground">Empresas</span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs">{company.name}</span>
        <div className="flex-1" />
        {company.careersUrl && (
          <a
            href={company.careersUrl.startsWith("http") ? company.careersUrl : `https://${company.careersUrl}`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs"
          >
            <ExternalLink className="size-3.5" />
            Careers
          </a>
        )}
      </div>

      <div className="flex items-start gap-4 px-8 py-6">
        <div className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-secondary text-lg font-bold">
          {company.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">{company.name}</h1>
            <span className="rounded-md bg-secondary px-2 py-0.5 text-xs">{HEALTH_LABEL[company.health]}</span>
            {company.isFavorite && (
              <span className="rounded-md bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                Favorita{company.priority ? ` · Prio ${company.priority}` : ""}
              </span>
            )}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>{company.stage ?? "estágio desconhecido"}</span>
            <span>·</span>
            <span>{company.totalRaisedRaw ?? "captação desconhecida"}</span>
            <span>·</span>
            <span>{company.headcount ? `~${company.headcount} pessoas` : "headcount desconhecido"}</span>
          </div>
        </div>
        <div className="flex shrink-0 gap-6 text-right">
          <div>
            <div className="text-lg font-bold tabular-nums">{company.jobs.length}</div>
            <div className="text-[10px] text-muted-foreground">VAGAS VISTAS</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums">
              {company.jobs.filter((j) => j.status === "SHORTLIST").length}
            </div>
            <div className="text-[10px] text-muted-foreground">NA SHORTLIST</div>
          </div>
          <div>
            <div className="text-lg font-bold tabular-nums text-primary">
              {company.jobs.filter((j) => j.status === "APLICADA").length}
            </div>
            <div className="text-[10px] text-muted-foreground">APLICADA</div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 gap-0 overflow-hidden px-8 pb-6">
        <div className="min-w-0 flex-1 overflow-auto pr-6">
          <div className="grid grid-cols-[1fr_70px_90px_90px_110px] gap-3 border-b border-border pb-2 text-[11px] font-medium text-muted-foreground">
            <span>Vaga</span>
            <span>Score</span>
            <span>Salário</span>
            <span>Encontrada</span>
            <span>Status</span>
          </div>
          {[...openJobs, ...discardedJobs].map((job) => (
            <Link
              key={job.id}
              href={`/vaga/${job.id}`}
              className="grid grid-cols-[1fr_70px_90px_90px_110px] items-center gap-3 border-b border-border py-2.5 hover:bg-secondary/40"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{job.title}</div>
                <div className="truncate text-xs text-muted-foreground">{job.stack.join(" · ") || "—"}</div>
              </div>
              <span className="text-sm tabular-nums">{job.compatibilityScore ?? "—"}</span>
              <span className="text-sm tabular-nums text-muted-foreground">{job.salaryRaw ?? "não decl."}</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {job.discoveredAt.toLocaleDateString("pt-BR")}
              </span>
              <span className="text-xs text-muted-foreground">{STATUS_LABELS[job.status]}</span>
            </Link>
          ))}
        </div>

        <div className="w-[320px] shrink-0 overflow-auto border-l border-border pl-6">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Boards monitorados
          </div>
          <div className="mt-2.5 flex flex-col gap-2">
            {company.boards.map((board) => (
              <div key={board.id} className="rounded-lg border border-border bg-card p-2.5">
                <div className="flex items-center gap-2">
                  <span className={`size-1.5 rounded-full ${board.enabled ? "bg-primary" : "bg-muted-foreground"}`} />
                  <span className="truncate text-xs font-medium">
                    {board.provider.toLowerCase()}:{board.slug}
                  </span>
                </div>
                {board.lastJobCount !== null && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    {board.lastJobCount} vaga(s) na última varredura
                  </div>
                )}
              </div>
            ))}
            {company.boards.length === 0 && (
              <p className="text-xs text-muted-foreground">Nenhum board monitorado ainda.</p>
            )}
          </div>

          <div className="my-5 h-px bg-border" />

          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Dossiê</div>
          <p className="mt-2.5 whitespace-pre-line text-xs leading-relaxed text-muted-foreground">
            {company.healthMarkdown?.slice(0, 1200) || "Sem dossiê importado."}
          </p>

          <div className="my-5 h-px bg-border" />

          <NotesSection notes={company.notes} companyId={company.id} path={`/empresa/${company.slug}`} />
        </div>
      </div>
    </div>
  );
}
