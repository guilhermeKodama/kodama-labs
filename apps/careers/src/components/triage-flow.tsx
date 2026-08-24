"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateJobStatus } from "@/server/modules/jobs/actions";
import { cn } from "@/lib/utils";
import { ExternalLink, ChevronDown } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

type TriageJob = {
  id: string;
  title: string;
  locationRaw: string | null;
  canonicalUrl: string | null;
  seniority: string;
  seniorityNote: string | null;
  workModel: string;
  salaryRaw: string | null;
  equity: string;
  hiresBrazil: string;
  stack: string[];
  company: { name: string; slug: string; health: string; stage: string | null };
  scores: { fitWhy: string | null; fitRedFlags: string | null; fitToConfirm: string | null }[];
  rawPostings: { url: string | null; descriptionText: string | null }[];
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

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-2.5 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-0.5 truncate text-xs font-medium">{value}</div>
    </div>
  );
}

export function TriageFlow({ jobs }: { jobs: TriageJob[] }) {
  const router = useRouter();
  const [index, setIndex] = React.useState(0);
  const [reason, setReason] = React.useState("");
  const [discardOpen, setDiscardOpen] = React.useState(false);
  const [descriptionOpen, setDescriptionOpen] = React.useState(false);
  const [isPending, startTransition] = React.useTransition();

  const job = jobs[index];
  const rawPosting = job?.rawPostings[0];
  const link = job?.canonicalUrl || rawPosting?.url || null;

  const advance = React.useCallback(() => {
    setReason("");
    setDescriptionOpen(false);
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

  const confirmDiscard = React.useCallback(() => {
    if (!job) return;
    startTransition(async () => {
      await updateJobStatus(job.id, "DESCARTADA", reason || undefined);
      router.refresh();
      setDiscardOpen(false);
      advance();
    });
  }, [job, reason, router, advance]);

  React.useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "TEXTAREA" || tag === "INPUT") return;
      if (discardOpen) return;
      if (e.key === "s" || e.key === "S") shortlist();
      if (e.key === "x" || e.key === "X") setDiscardOpen(true);
      if (e.key === "ArrowRight") advance();
      if ((e.key === "a" || e.key === "A") && link) window.open(link, "_blank");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [shortlist, advance, link, discardOpen]);

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
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 overflow-auto p-7">
      <div className="flex items-start gap-4">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-base font-bold">
          {job.company.name.charAt(0)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight">{job.title}</h2>
            <span className="text-xs text-muted-foreground">
              {index + 1}/{jobs.length}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="text-foreground">{job.company.name}</span>
            <span>·</span>
            <span>{job.locationRaw || "local não informado"}</span>
            <span>·</span>
            <span>{job.company.stage ?? "estágio desconhecido"}</span>
          </div>
        </div>
        {link && (
          <a
            href={link}
            target="_blank"
            rel="noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ExternalLink className="size-3.5" />
            abrir anúncio (A)
          </a>
        )}
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Fact label="Senioridade" value={job.seniorityNote || job.seniority} />
        <Fact label="Modelo" value={job.workModel.toLowerCase().replace(/_/g, " ")} />
        <Fact label="Salário" value={job.salaryRaw || "não declarado"} />
        <Fact label="Equity" value={job.equity.toLowerCase().replace(/_/g, " ")} />
      </div>
      {job.stack.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {job.stack.map((s) => (
            <span key={s} className="rounded-md bg-secondary px-2 py-0.5 text-[11px] text-secondary-foreground">
              {s}
            </span>
          ))}
        </div>
      )}

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

      {rawPosting?.descriptionText && (
        <div className="rounded-xl border border-border bg-card">
          <button
            type="button"
            onClick={() => setDescriptionOpen((v) => !v)}
            className="flex w-full items-center justify-between p-3.5 text-left"
          >
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Descrição completa do anúncio
            </span>
            <ChevronDown className={cn("size-4 text-muted-foreground transition-transform", descriptionOpen && "rotate-180")} />
          </button>
          {descriptionOpen && (
            <p className="whitespace-pre-line border-t border-border p-3.5 text-sm leading-relaxed text-muted-foreground">
              {rawPosting.descriptionText}
            </p>
          )}
        </div>
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
          onClick={() => setDiscardOpen(true)}
          className="flex items-center gap-2 rounded-lg border border-destructive/40 px-4 py-2 text-sm text-destructive disabled:opacity-50"
        >
          Descartar
          <kbd className="rounded bg-destructive/15 px-1.5 py-0.5 text-[10px] font-bold">X</kbd>
        </button>
        <button type="button" onClick={advance} className="flex items-center gap-2 rounded-lg border border-border px-4 py-2 text-sm text-muted-foreground">
          Pular
          <kbd className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-bold">→</kbd>
        </button>
      </div>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Motivo do descarte</DialogTitle>
            <DialogDescription>Escolha um padrão ou escreva — fica registrado com a vaga.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
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
            autoFocus
            className="h-24 w-full resize-none rounded-lg border border-input bg-background p-2.5 text-sm outline-none"
          />
          <DialogFooter>
            <button
              type="button"
              onClick={() => setDiscardOpen(false)}
              className="rounded-lg border border-border px-3.5 py-2 text-sm text-muted-foreground"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={isPending}
              onClick={confirmDiscard}
              className="rounded-lg bg-destructive px-3.5 py-2 text-sm font-semibold text-destructive-foreground disabled:opacity-50"
            >
              Confirmar descarte
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
