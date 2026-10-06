"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { Btn, Check, Dialog, DialogHead, Kbd } from "@/components/cap";
import { apiDelete, apiPost } from "@/lib/api/client";
import { useCategories, type CategoryRecord, type Names } from "@/lib/api/catalog";
import { rememberUndo, undoBatch } from "@/lib/api/undo";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import {
  applyDraft,
  baseRate,
  blankForm,
  buildCreateRequest,
  buyHolding,
  formCurrency,
  investSides,
  nextAfterSave,
  typedAmount,
  typedRate,
  type EntryFormState,
  type FormField,
  type FormRequest,
} from "@/lib/ledger/entry-form";
import type { QuickAddDraft } from "@/lib/ledger/quick-add";
import { useShortcut, useShortcutLabel } from "@/lib/shortcuts/provider";
import { Dropzone, pastedFiles, uploadReceipt, type AttachmentOwner, type AttachmentRecord } from "./entry/attachments";
import { QuickAddBox } from "./entry/quick-add-box";
import { TxFormBody } from "./entry/tx-form-body";
import { useFormContext } from "./entry/use-form-context";
import { useCategorySuggestion } from "./entry/use-suggestion";

export interface EntryDialogProps {
  names: Names;
  /** Prefilled fields (quick add in ⌘K, ?create={…}); null or {} for a blank form. */
  draft: QuickAddDraft | null;
  onClose: () => void;
}

/**
 * "Nova transação" (mockup CreateFlow 4968-5086), opened by ?create=
 * (overlays.tsx mounts it only while open) from "+ Nova transação", N or
 * ⌘K: a 600px dialog with the quick add, the shared form (TxFormBody),
 * "Criar outra em seguida", Cancelar, ⌘↵ and Salvar. Saving is one
 * undoable write; receipts dropped or pasted (⌘V) are uploaded right after.
 */
export function EntryDialog({ draft, onClose }: EntryDialogProps) {
  const t = useTranslations("entry.form");
  const { ready } = useFormContext();
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()} width={600}>
      <DialogHead title={t("createTitle")} desc={t("createDesc")} />
      {ready ? <CreateForm draft={draft ?? {}} onClose={onClose} /> : null}
    </Dialog>
  );
}

interface SaveVariables {
  request: FormRequest;
  files: File[];
  newCategory: { name: string; type: "income" | "expense" } | null;
  toastText: (description: string) => string;
}

interface SaveResult {
  createdBatchId: string | null;
  description: string;
  uploaded: AttachmentRecord[];
  /** Receipts that could not be uploaded (the entry was created anyway). */
  failedUploads: number;
}

/** The entry or transfer a create answered with, to hang receipts on. */
function ownerOf(result: Record<string, unknown>): AttachmentOwner | null {
  const groups = Array.isArray(result.transferGroupIds) ? (result.transferGroupIds as string[]) : [];
  const group = typeof result.transferGroupId === "string" ? result.transferGroupId : groups[groups.length - 1];
  if (group) return { ownerType: "transfer", ownerId: group };
  const entry = Array.isArray(result.entryIds) ? (result.entryIds[0] as string | undefined) : undefined;
  return entry ? { ownerType: "entry", ownerId: entry } : null;
}

function CreateForm({ draft, onClose }: { draft: QuickAddDraft; onClose: () => void }) {
  const t = useTranslations("entry");
  const tCommon = useTranslations("common");
  const fmt = useFmt();
  const formatAmount = (value: number) => fmt.number(value);
  const base = useFormContext();
  const [form, setForm] = useState<EntryFormState>(() => applyDraft(blankForm(base.ctx), draft, base.ctx, formatAmount));
  const { ctx, accounts } = useFormContext({ holdings: form.kind === "invest" });
  const categories = useCategories(true);
  const [newCategory, setNewCategory] = useState<string | null>(draft.categoryId ? null : (draft.categoryName ?? null));
  const [another, setAnother] = useState(false);
  const [invalid, setInvalid] = useState<FormField | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [askAi, setAskAi] = useState(false);
  const [round, setRound] = useState(0);
  const saveLabel = useShortcutLabel("mod+enter");

  const up = (patch: Partial<EntryFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    if (patch.categoryId) setNewCategory(null);
    setInvalid(null);
  };

  const simple = form.kind === "expense" || form.kind === "income";
  const suggestion = useCategorySuggestion({
    description: form.description,
    entityId: form.entityId,
    kind: form.kind === "income" ? "income" : "expense",
    enabled: simple && !form.categoryId && !newCategory,
    ai: askAi,
  });

  const save = useAppMutation<SaveResult, SaveVariables>({
    event: ["ledger.write", "recurring.write", "investments.write"],
    mutationFn: async ({ request, files: queued, newCategory: create }) => {
      const body = { ...request.body };
      if (create) {
        const category = await apiPost<CategoryRecord>("/api/v2/categories", create);
        body.categoryId = category.id;
        // If the save below fails, a retry uses this category instead of creating the name again.
        setForm((current) => ({ ...current, categoryId: category.id }));
        setNewCategory(null);
      }
      const result = await apiPost<Record<string, unknown>>(request.path, body);
      const owner = queued.length ? ownerOf(result) : null;
      const uploaded: AttachmentRecord[] = [];
      let failedUploads = 0;
      // The entry exists now: a receipt that fails to upload must not fail the save (a retry would create it twice).
      if (owner) {
        for (const file of queued) {
          try {
            uploaded.push(await uploadReceipt(owner, file));
          } catch {
            failedUploads++;
          }
        }
      }
      const entries = Array.isArray(result.entries) ? (result.entries as { description?: string }[]) : [];
      const description = (body.description as string | undefined) ?? entries[0]?.description ?? (typeof result.description === "string" ? result.description : "");
      return { createdBatchId: typeof result.batchId === "string" ? result.batchId : null, description, uploaded, failedUploads };
    },
    onSuccess: (result, variables) => {
      const message = variables.toastText(result.description);
      const batchId = result.createdBatchId;
      if (result.failedUploads) toast(t("form.uploadFailed", { count: result.failedUploads }));
      if (batchId) {
        // ⌘Z undoes the bare batch, which keeps a row that has receipts; with receipts only the toast's Desfazer (which drops them first) undoes it.
        if (!result.uploaded.length) rememberUndo(batchId, message);
        // Undo keeps rows that carry receipts the batch did not record, so Desfazer removes the receipts first.
        toast(message, {
          id: `undo:${batchId}`,
          duration: 6000,
          action: {
            label: tCommon("undo"),
            onClick: () =>
              void Promise.all(result.uploaded.map((file) => apiDelete(`/api/v2/attachments/${encodeURIComponent(file.id)}`).catch(() => undefined))).then(() => undoBatch(batchId)),
          },
        });
      } else toast(message);
      if (another) {
        setForm(nextAfterSave(form, ctx));
        setFiles([]);
        setNewCategory(null);
        setAskAi(false);
        setRound((n) => n + 1);
      } else onClose();
    },
  });

  const submit = () => {
    if (save.isPending) return;
    const built = buildCreateRequest(form, ctx, {
      suggestedCategoryId: suggestion && suggestion.source !== "rule" ? suggestion.categoryId : null,
      investDescription: (deposit, broker) => t(deposit ? "form.invest.defaultDeposit" : "form.invest.defaultWithdraw", { broker }),
    });
    if (!built.ok) {
      setInvalid(built.field);
      toast(t(`errors.${built.error}`));
      return;
    }
    const amount = typedAmount(form, ctx);
    const currency = formCurrency(form, ctx);
    const inBase = amount * typedRate(form.rate, baseRate(currency, ctx), ctx);
    const signed = form.kind === "expense" ? -inBase : inBase;
    const sides = investSides(form, ctx);
    const buy = form.buyAlso ? buyHolding(form, ctx) : null;
    const toastText = (description: string) => {
      if (built.request.creates === "recurring") return t("toast.recurringCreated", { description, amount: fmt.money(signed, ctx.baseCurrency) });
      if (form.kind === "invest") {
        const money = fmt.money(amount, sides.from?.currency);
        return buy && sides.deposit
          ? t("toast.aporteBuy", { amount: money, qty: form.buyQty, ticker: buy.holding.ticker ?? buy.holding.name, broker: sides.broker?.name ?? "" })
          : t("toast.aporte", { dir: form.investDir, amount: money });
      }
      return t("toast.created", { description, amount: fmt.money(signed, ctx.baseCurrency) });
    };
    save.mutate({
      request: built.request,
      files,
      newCategory: newCategory && simple && !form.categoryId ? { name: newCategory, type: form.kind === "income" ? "income" : "expense" } : null,
      toastText,
    });
  };

  useShortcut("mod+enter", () => submit(), { allowInInputs: true });

  return (
    <div
      className="flex flex-col gap-3.5"
      onPaste={(event) => {
        const pasted = pastedFiles(event);
        if (pasted.length) setFiles((current) => [...current, ...pasted]);
      }}
    >
      <TxFormBody
        key={round}
        form={form}
        up={up}
        ctx={ctx}
        accounts={accounts}
        mode="create"
        invalid={invalid}
        suggestion={suggestion}
        newCategoryName={newCategory}
        onDescriptionBlur={() => setAskAi(true)}
        quickAdd={
          <QuickAddBox
            ctx={ctx}
            categories={categories.data ?? []}
            onFill={(filled) => {
              setForm((current) => applyDraft(current, filled, ctx, formatAmount));
              setNewCategory(filled.categoryId ? null : (filled.categoryName ?? null));
              setInvalid(null);
            }}
          />
        }
        dropzone={
          <Dropzone
            onFiles={(added) => setFiles((current) => [...current, ...added])}
            items={files.map((file, index) => ({ key: `${index}:${file.name}`, name: file.name, onRemove: () => setFiles((current) => current.filter((_, i) => i !== index)) }))}
          />
        }
      />
      <div className="flex items-center gap-2 border-t border-stroke-3 pt-3">
        <Check checked={another} onChange={setAnother} label={t("form.another")} />
        <span className="flex-1" />
        <Btn ghost onClick={onClose}>
          {tCommon("cancel")}
        </Btn>
        <Kbd>{saveLabel}</Kbd>
        <Btn primary onClick={submit} disabled={save.isPending}>
          {tCommon("save")}
        </Btn>
      </div>
    </div>
  );
}
