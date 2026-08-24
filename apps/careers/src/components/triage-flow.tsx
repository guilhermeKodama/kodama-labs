"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateJobStatus } from "@/server/modules/jobs/actions";
import { cn } from "@/lib/utils";
import { ExternalLink } from "lucide-react";

type TriageJob = {
  id: string;
  title: string;
  locationRaw: string | null;
  canonicalUrl: string | null;
  company: { name: string; slug: string; health: string; stage: string | null };
  scores: { fitWhy: string | null; fitRedFlags: string | null; fitToConfirm: string | null }[];
};

const REASON_CHIPS = [
  "Opera, não constrói",
  "People management",
  "Stack a evitar",
  "Abaixo do piso",
  "Não contrata BR",
  "Setor vetado",
  "Vaga fechou",
];

export function TriageFlow({ jobs }: { jobs: TriageJob[] }) {
  const router = useRouter();
  const [index, setIndex] = React.useState(0);
  const [reason, setReason] = React.useState("");
  const [isPending, startTransition] = React.useTransition();

  const job = jobs[index];

  const advance = React.useCallback(() => {
    setReason("");
    setIndex((i) => Math.min(i + 1, jobs.length));
  }, [jobs.length]);

  const shortlist = React.useCallback(() => {
    if (!job) return;
    startTransition(async () => {
      await updateJobStatus(job.id, "SHORTLIST");
      router.refresh();
      advance();
    });
  }, [job, router, advance]);

  const discard = React.useCallback(() => {
    if (!job) return;
    startTransition(async () => {
      await updateJobStatus(job.id, "DESCARTADA", reason || undefined);
      router.refresh();
      advance();
    });
  }, [job, reason, router, advance]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (e.key === "s" || e.key === "S") shortlist();
      if (e.key === "x" || e.key === "X") discard();
      if (e.key === "ArrowRight") advance();
      if ((e.key === "a" || e.key === "A") && job?.canonicalUrl) window.open(job.canonicalUrl, "_blank");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortlist, discard, advance, job]);

  if (!job) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <p className="text-lg font-medium">Fila de triagem vazia 🎉</p>
        <p className="text-sm text-muted-foreground">Nada parado em Radar/Triagem no momento.</p>
        <Link href="/" className="mt-3 text-sm underline">
          Voltar para vagas
        </Link>
      </div>
    );
  }

  const score = job.scores[0];

  return (
    <div className="flex h-full">
      <div className="flex flex-1 flex-col gap-4 overflow-auto p-7">
        <div className="flex items-start gap-4">
          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-base font-bold">
            {job.company.name.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-semibold tracking-tight">{job.title}</h2>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="text-foreground">{job.company.name}</span>
              <span>·</span>
              <span>{job.locationRaw || "local não informado"}</span>
              <span>·</span>
              <span>{job.company.stage ?? "estágio desconhecido"}</span>
            </div>
          </div>
        </div>

        {score ? (
          <div className="flex flex-col gap-2.5">
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                Por que casa
              </div>
              <p className="mt-1 text-sm leading-relaxed">{score.fitWhy || "—"}</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-destructive">
                Sinais de alerta
              </div>
              <p className="mt-1 text-sm leading-relaxed">{score.fitRedFlags || "—"}</p>
            </div>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Ainda sem avaliação do modelo — o worker de score ainda não processou esta vaga.
          </p>
        )}

        <div className="flex-1" />

        <div className="flex items-center gap-2.5">
          <button
            type="button"
            disabled={isPending}
            onClick={shortlist}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            Shortlist
            <kbd className="rounded bg-primary-foreground/15 px-1.5 py-0.5 text-[10px] font-bold">S</kbd>
          </button>
          <button
            type="button"
            disabled={isPending}
            onClick={discard}
            className="flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm text-destructive disabled:opacity-50"
          >
            Descartar
            <kbd className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold">X</kbd>
          </button>
          <button type="button" onClick={advance} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">
            Pular
            <kbd className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold">→</kbd>
          </button>
          <div className="flex-1" />
          {job.canonicalUrl && (
            <a href={job.canonicalUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <ExternalLink className="size-3.5" />
              abrir anúncio (A)
            </a>
          )}
        </div>
      </div>

      <div className="w-[340px] shrink-0 border-l border-border p-6">
        <div className="text-sm font-semibold">Motivo do descarte</div>
        <p className="mt-1 text-xs text-muted-foreground">Escolha um padrão ou escreva.</p>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {REASON_CHIPS.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => setReason(chip)}
              className={cn(
                "rounded-lg border px-2.5 py-1 text-xs",
                reason === chip ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border text-muted-foreground"
              )}
            >
              {chip}
            </button>
          ))}
        </div>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo em texto livre..."
          className="mt-3 h-28 w-full resize-none rounded-lg border border-input bg-background p-2.5 text-sm outline-none"
        />
        <div className="mt-5 text-xs text-muted-foreground">
          {index + 1} de {jobs.length} nesta fila
        </div>
      </div>
    </div>
  );
}
