import Link from "next/link";
import { notFound } from "next/navigation";
import { getJobDetail, STATUS_LABELS } from "@/server/modules/jobs/queries";
import { JobStatusSelect } from "@/components/job-status-select";
import { NotesSection } from "@/components/notes-section";
import { ArrowLeft, ExternalLink } from "lucide-react";

export const dynamic = "force-dynamic";

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2.5">
      <span className="w-28 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="text-sm">{value}</span>
    </div>
  );
}

export default async function JobDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = await getJobDetail(id);
  if (!job) notFound();

  const score = job.scores[0];

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-6">
        <Link href="/" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" />
        </Link>
        <span className="text-xs text-muted-foreground">Vagas</span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-xs">{job.company.name}</span>
        <div className="flex-1" />
        {job.canonicalUrl && (
          <a
            href={job.canonicalUrl}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs"
          >
            <ExternalLink className="size-3.5" />
            Abrir anúncio
          </a>
        )}
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div className="flex-1 overflow-auto px-8 py-6">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <JobStatusSelect jobId={job.id} status={job.status} />
            <span>encontrada em {job.discoveredAt.toLocaleDateString("pt-BR")}</span>
          </div>
          <h1 className="mt-2.5 text-2xl font-semibold tracking-tight">{job.title}</h1>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link href={`/empresa/${job.company.slug}`} className="font-medium text-foreground hover:underline">
              {job.company.name}
            </Link>
            <span>·</span>
            <span>{job.locationRaw || "localização não informada"}</span>
            <span>·</span>
            <span>{job.currency ?? "moeda não informada"}</span>
            <span>·</span>
            <span>equity {job.equity.toLowerCase().replace("_", " ")}</span>
          </div>

          {score && (
            <div className="mt-6 flex flex-col gap-3">
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Por que casa
                </div>
                <p className="mt-1.5 text-sm leading-relaxed">{score.fitWhy || "—"}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-destructive">
                  Sinais de alerta
                </div>
                <p className="mt-1.5 text-sm leading-relaxed">{score.fitRedFlags || "—"}</p>
              </div>
              <div className="rounded-xl border border-border bg-card p-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  A confirmar
                </div>
                <p className="mt-1.5 text-sm leading-relaxed">{score.fitToConfirm || "—"}</p>
              </div>
            </div>
          )}

          {job.rejectionReason && (
            <div className="mt-4 rounded-xl border border-destructive/30 bg-card p-4">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-destructive">
                Motivo do descarte
              </div>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-relaxed">{job.rejectionReason}</p>
            </div>
          )}

          <div className="mt-6">
            <NotesSection notes={job.notes} jobId={job.id} path={`/vaga/${job.id}`} />
          </div>
        </div>

        <div className="w-[320px] shrink-0 overflow-auto border-l border-border p-6">
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold tabular-nums tracking-tight">
              {job.compatibilityScore ?? "—"}
            </span>
            <span className="text-[10px] tracking-wide text-muted-foreground">COMPATIBILIDADE</span>
          </div>

          <div className="mt-5 flex flex-col gap-2.5">
            <Fact label="Senioridade" value={job.seniority} />
            <Fact label="Trilha" value={job.track} />
            <Fact label="Modelo" value={job.workModel} />
            <Fact label="Contrata BR" value={job.hiresBrazilNote || job.hiresBrazil} />
            <Fact label="Salário" value={job.salaryRaw || "não declarado"} />
            <Fact label="Equity" value={job.equityNote || job.equity} />
            <Fact label="Stack" value={job.stack.join(", ") || "—"} />
            <Fact label="Setor" value={job.sector || "—"} />
          </div>

          <div className="my-5 h-px bg-border" />

          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Empresa
          </div>
          <div className="mt-2.5 rounded-xl border border-border bg-card p-3">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-sm font-semibold">{job.company.name}</span>
              <span className="text-[11px] text-muted-foreground">{job.company.health}</span>
            </div>
            <div className="mt-1.5 text-xs text-muted-foreground">
              {job.company.stage ?? "estágio desconhecido"}
            </div>
          </div>

          <div className="my-5 h-px bg-border" />

          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Histórico
          </div>
          <div className="mt-2.5 flex flex-col gap-2">
            {job.statusChanges.map((change) => (
              <div key={change.id} className="text-xs text-muted-foreground">
                <span className="text-foreground">{STATUS_LABELS[change.toStatus]}</span> · {change.actor} ·{" "}
                {change.changedAt.toLocaleDateString("pt-BR")}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
