"use client";

import { useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import type { ExecuteImportResult } from "@capital/server/modules/bank-statements/services/execute-import";
import { Btn, Dialog, DialogFooter, DialogHead } from "@/components/cap";
import { useRouter } from "@/i18n/navigation";
import { useAccounts } from "@/lib/api/catalog";
import { apiPost } from "@/lib/api/client";
import { useSession } from "@/lib/api/session";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { filePayload, goesToAssistant, type ImportFilePayload } from "@/lib/import/files";
import {
  accountForEntity,
  buildImportPlan,
  canCommit,
  initialDecisions,
  reviewSummary,
  type Decisions,
  type ImportAnalysis,
  type ReviewFilter,
} from "@/lib/import/review";
import { buildTransactionsHref } from "@/lib/ledger/view-draft";
import { openAssistant } from "@/lib/shell/assistant-bridge";
import { useShortcut } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { ConfirmStep, DoneState } from "./confirm-step";
import { FileStep } from "./file-step";
import { ReviewStep } from "./review-step";

export interface ImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Account to import into when the file does not say (e.g. opened from an account). */
  defaultAccountId?: string;
}

/**
 * "Importar extrato" (mockup 5636-5826), opened by ?import=1 over
 * Transações: a 720px dialog in three steps. Arquivo reads the files
 * (POST /v2/imports/analyze: bank, period, count, the detected account;
 * PDFs and pictures go to the assistant), Revisar sets what each row
 * becomes, Confirmar shows the totals and commits the plan as one
 * undoable import (POST /v2/imports), ending on "Abrir a view da
 * importação" and "Desfazer importação". Nothing is written before that.
 */
export function ImportDialog({ open, onOpenChange, defaultAccountId }: ImportDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange} width={720}>
      {open ? <ImportFlow onClose={() => onOpenChange(false)} defaultAccountId={defaultAccountId ?? null} /> : null}
    </Dialog>
  );
}

const STEPS = ["file", "review", "confirm"] as const;
type Step = 0 | 1 | 2;

export type CommitResult = ExecuteImportResult;

interface AnalyzeVars {
  files: ImportFilePayload[];
  accountId: string | null;
  /** Bumped per request: only the latest answer is applied. */
  seq: number;
}

function ImportFlow({ onClose, defaultAccountId }: { onClose: () => void; defaultAccountId: string | null }) {
  const t = useTranslations("import");
  const router = useRouter();
  const me = useSession().data;
  const accountsQuery = useAccounts(true);
  const accounts = useMemo(() => accountsQuery.data ?? [], [accountsQuery.data]);

  const [step, setStep] = useState<Step>(0);
  const [files, setFiles] = useState<File[]>([]);
  const [payload, setPayload] = useState<ImportFilePayload[] | null>(null);
  const [analysis, setAnalysis] = useState<ImportAnalysis | null>(null);
  const [accountId, setAccountId] = useState<string | null>(defaultAccountId);
  /** The entity picked in "Entidade" until an account of it is analyzed. */
  const [entityChoice, setEntityChoice] = useState<string | null>(null);
  const [decisions, setDecisions] = useState<Decisions>({});
  const [filter, setFilter] = useState<ReviewFilter>("all");
  const [linkBill, setLinkBill] = useState(true);
  const [done, setDone] = useState<CommitResult | null>(null);
  const seq = useRef(0);

  const viaAssistant = files.length > 0 && files.some((file) => goesToAssistant(file));

  const analyze = useAppMutation({
    event: null,
    mutationFn: ({ files: body, accountId: chosen }: AnalyzeVars) =>
      apiPost<ImportAnalysis>("/api/v2/imports/analyze", { files: body, ...(chosen ? { accountId: chosen } : {}), ai: true }),
    onSuccess: (data, vars) => {
      if (vars.seq !== seq.current) return;
      setAnalysis(data);
      setAccountId(data.suggestedAccountId ?? vars.accountId);
      setEntityChoice(null);
      setDecisions(initialDecisions(data));
      setFilter("all");
    },
  });

  const runAnalyze = (body: ImportFilePayload[], chosen: string | null) => {
    seq.current += 1;
    analyze.mutate({ files: body, accountId: chosen, seq: seq.current });
  };

  const pickFiles = async (picked: File[]) => {
    const list = picked.slice(0, 10);
    if (!list.length) return;
    seq.current += 1;
    setFiles(list);
    setPayload(null);
    setAnalysis(null);
    setDecisions({});
    setEntityChoice(null);
    setAccountId(defaultAccountId);
    setStep(0);
    if (list.some((file) => goesToAssistant(file))) return;
    const body = await Promise.all(list.map((file) => filePayload(file)));
    setPayload(body);
    runAnalyze(body, defaultAccountId);
  };

  const changeAccount = (id: string | null) => {
    setAccountId(id);
    if (id && payload) runAnalyze(payload, id);
  };

  const changeEntity = (id: string) => {
    if (!analysis) return;
    setEntityChoice(id);
    changeAccount(accountForEntity(accounts, id, analysis.kind));
  };

  const entityId = entityChoice ?? analysis?.entityId ?? null;
  const entity = me?.entities.find((e) => e.id === entityId) ?? null;
  const account = accounts.find((a) => a.id === accountId) ?? null;
  const summary = useMemo(() => reviewSummary(analysis?.rows ?? [], decisions), [analysis, decisions]);
  const ready = !analyze.isPending && !entityChoice && !!entity && canCommit(analysis, accountId);

  const commit = useAppMutation({
    event: "imports.write",
    mutationFn: () => {
      if (!analysis || !accountId || !entity) throw new Error("The import plan is incomplete");
      const plan = buildImportPlan(analysis, decisions, {
        entity: { id: entity.id, kind: entity.kind },
        accountId,
        entityKinds: new Map((me?.entities ?? []).map((e) => [e.id, e.kind])),
        currency: account?.currency ?? me?.baseCurrency ?? "BRL",
        linkPayment: linkBill,
      });
      return apiPost<CommitResult>("/api/v2/imports", plan);
    },
    onSuccess: (result) => setDone(result),
  });

  const revert = useAppMutation({
    event: "imports.write",
    mutationFn: (importId: string) => apiPost<{ batchId: string | null }>(`/api/v2/imports/${encodeURIComponent(importId)}/revert`),
    undo: t("done.undone"),
    onSuccess: () => {
      setDone(null);
      setStep(0);
      // Its rows left the ledger: read the file again for fresh statuses.
      if (payload) runAnalyze(payload, accountId);
    },
  });

  const sendToAssistant = () => {
    openAssistant({ files, prompt: t("file.assistantPrompt") });
    onClose();
  };

  const canSubmit = step === 0 ? viaAssistant || ready : step === 1 ? ready : ready && summary.included > 0 && !commit.isPending;
  const primary = () => {
    if (done || !canSubmit) return;
    if (step === 0 && viaAssistant) sendToAssistant();
    else if (step < 2) setStep((step + 1) as Step);
    else commit.mutate();
  };
  useShortcut("mod+enter", primary, { allowInInputs: true });

  const currency = analysis?.currency ?? account?.currency ?? me?.baseCurrency ?? "BRL";

  return (
    <>
      <DialogHead title={t("dialog.title")} desc={t("dialog.desc")} />
      {done ? null : <Stepper step={step} />}
      {done ? (
        <DoneState
          result={done}
          reverting={revert.isPending}
          onOpenView={() => {
            if (done.viewId) router.push(buildTransactionsHref({ viewId: done.viewId }));
          }}
          onUndo={() => revert.mutate(done.importId)}
        />
      ) : step === 0 ? (
        <FileStep
          files={files}
          analysis={analysis}
          reading={analyze.isPending || (files.length > 0 && !viaAssistant && !payload)}
          viaAssistant={viaAssistant}
          accountId={accountId}
          entityId={entityId}
          linkBill={linkBill}
          onPick={(picked) => void pickFiles(picked)}
          onAccountChange={changeAccount}
          onEntityChange={changeEntity}
          onLinkBillChange={setLinkBill}
        />
      ) : !analysis ? null : step === 1 ? (
        <ReviewStep
          analysis={analysis}
          decisions={decisions}
          filter={filter}
          currency={currency}
          entityId={entityId}
          onFilter={setFilter}
          onDecisions={setDecisions}
        />
      ) : (
        <ConfirmStep analysis={analysis} summary={summary} currency={currency} linkBill={linkBill} accounts={accounts} account={account} />
      )}
      {done ? null : (
        <DialogFooter>
          {step > 0 ? (
            <Btn ghost onClick={() => setStep((step - 1) as Step)}>
              {t("nav.back")}
            </Btn>
          ) : null}
          <Btn primary disabled={!canSubmit} onClick={primary}>
            {step === 0 && viaAssistant
              ? t("nav.assistant")
              : step < 2
                ? t("nav.continue")
                : commit.isPending
                  ? t("nav.committing")
                  : t("nav.commit", { count: summary.included })}
          </Btn>
        </DialogFooter>
      )}
    </>
  );
}

/** Arquivo → Revisar → Confirmar: numbered circles, ✓ on the steps behind, 24px connectors. */
function Stepper({ step }: { step: Step }) {
  const t = useTranslations("import.steps");
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((name, i) => (
        <span key={name} className={cn("inline-flex items-center gap-1.5 text-[12px]", i === step ? "font-semibold text-fg-1" : "text-fg-3")}>
          <span
            className={cn(
              "inline-flex size-[18px] items-center justify-center rounded-full border font-mono text-[10px]",
              i <= step ? "border-fg-1 bg-fg-1 text-editor" : "border-stroke-1 text-fg-3",
            )}
          >
            {i < step ? "✓" : i + 1}
          </span>
          {t(name)}
          {i < STEPS.length - 1 ? <span className="h-px w-6 bg-stroke-2" /> : null}
        </span>
      ))}
    </div>
  );
}
