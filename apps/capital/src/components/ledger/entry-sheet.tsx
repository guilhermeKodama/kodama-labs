"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocale, useTranslations } from "next-intl";
import { toast } from "sonner";
import type { LedgerRow } from "@capital/server/modules/ledger/contracts";
import type { EntryHistory } from "@capital/server/modules/ledger/services/history";
import { Btn, DialogHead, Sheet } from "@/components/cap";
import { apiGet } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useFmt } from "@/lib/format/provider";
import { buildEditPatch, formFromEntry, type EditableEntry, type EntryFormState, type FormField, type FormKind } from "@/lib/ledger/entry-form";
import { fieldGender, historyLines, type HistoryLine } from "@/lib/ledger/entry-history";
import { useShortcut } from "@/lib/shortcuts/provider";
import { Dropzone, pastedFiles, useOwnerAttachments } from "./entry/attachments";
import { TxFormBody } from "./entry/tx-form-body";
import { useFormContext } from "./entry/use-form-context";
import { useEntryPatch } from "./inline-edit";
import { useRowActions, type RowActions } from "./row-actions";
import type { DisplayRow } from "./rows";

export interface EntrySheetProps {
  /** The entry to show (any leg of a transfer). */
  entryId: string;
  /** The row as listed on screen; without it (a link, a ⌘K result) the sheet fetches the entry. */
  row: DisplayRow | null;
  names: Names;
  onClose: () => void;
}

/**
 * "Editar transação" (mockup TxSheet 5088-5126), opened by ?entry=<id>
 * (mounted by overlays.tsx while that param is set): a 440px sheet with
 * the shared form, the receipts, "Histórico" (GET /v2/ledger/entries/{id}/
 * history) and Salvar / Duplicar / Excluir. ⌘↵ saves, ⌘D duplicates, Esc
 * closes. Salvar sends only what changed, as one undoable PATCH.
 */
export function EntrySheet({ entryId, row, onClose }: EntrySheetProps) {
  const t = useTranslations("entry");
  const fmt = useFmt();
  const entry = useQuery({
    queryKey: keys.entry(entryId),
    queryFn: () => apiGet<LedgerRow>(`/api/v2/ledger/entries/${encodeURIComponent(entryId)}`),
  });
  const { ready } = useFormContext();
  const actions = useRowActions({ onDeleted: onClose });
  const description = entry.data?.description ?? row?.description ?? "";
  const date = entry.data?.date ?? row?.date;
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} width={440}>
      <DialogHead title={t("form.editTitle")} desc={description ? t("form.editDesc", { description, date: fmt.dateFull(date) }) : undefined} />
      {entry.data && ready ? (
        <EditForm key={entry.data.id} entry={entry.data} actions={actions} onClose={onClose} />
      ) : (
        <p className="text-[12.5px] text-fg-3">{entry.isError ? null : t("sheet.loading")}</p>
      )}
      {actions.dialogs}
    </Sheet>
  );
}

const ALL_KINDS: FormKind[] = ["expense", "income", "transfer", "invest"];

/** Kinds an existing entry cannot become: income ↔ expense only; a transfer or aporte stays one. */
function lockedKinds(entry: LedgerRow, form: EntryFormState): FormKind[] {
  if (entry.transferGroupId || entry.kind === "investment") return ALL_KINDS.filter((kind) => kind !== form.kind);
  return ["transfer", "invest"];
}

function EditForm({ entry, actions, onClose }: { entry: LedgerRow; actions: RowActions; onClose: () => void }) {
  const t = useTranslations("entry");
  const tCommon = useTranslations("common");
  const fmt = useFmt();
  const { ctx, accounts } = useFormContext();
  const editable: EditableEntry = entry;
  const [initial] = useState(() => formFromEntry(editable, ctx, (value) => fmt.number(value), (value) => fmt.number(value, { min: 2, max: 6 })));
  const [form, setForm] = useState(initial);
  const [invalid, setInvalid] = useState<FormField | null>(null);
  const save = useEntryPatch(() => onClose());
  const owner = entry.transferGroupId ? { ownerType: "transfer" as const, ownerId: entry.transferGroupId } : { ownerType: "entry" as const, ownerId: entry.id };
  const attachments = useOwnerAttachments(owner);
  const locked = lockedKinds(entry, initial);

  const up = (patch: Partial<EntryFormState>) => {
    setForm((current) => ({ ...current, ...patch }));
    setInvalid(null);
  };

  const submit = () => {
    if (save.isPending) return;
    const built = buildEditPatch(editable, initial, form, ctx);
    if (!built.ok) {
      setInvalid(built.field);
      toast(t(`errors.${built.error}`));
      return;
    }
    if (!Object.keys(built.patch).length) return onClose();
    save.mutate({ row: entry, patch: built.patch, message: t("toast.saved", { description: form.description.trim() || entry.description }) });
  };

  useShortcut("mod+enter", () => submit(), { allowInInputs: true });
  useShortcut("mod+d", () => {
    actions.duplicate(entry);
    onClose();
  });

  return (
    <div
      className="flex flex-col gap-3.5"
      onPaste={(event) => {
        const pasted = pastedFiles(event);
        if (pasted.length) attachments.add(pasted);
      }}
    >
      <TxFormBody
        form={form}
        up={up}
        ctx={ctx}
        accounts={accounts}
        mode="edit"
        lockedKinds={locked}
        invalid={invalid}
        suggestion={null}
        dropzone={<Dropzone onFiles={attachments.add} items={attachments.items} disabled={attachments.busy} />}
      />
      <History entryId={entry.id} />
      <div className="flex gap-1.5">
        <Btn primary onClick={submit} disabled={save.isPending}>
          {t("sheet.save")}
        </Btn>
        <Btn
          onClick={() => {
            actions.duplicate(entry);
            onClose();
          }}
        >
          {t("sheet.duplicate")}
        </Btn>
        <span className="flex-1" />
        <Btn ghost onClick={() => actions.remove(entry)}>
          {tCommon("delete")}
        </Btn>
      </div>
    </div>
  );
}

/** "Histórico" (mockup 5106-5113): one "· line" per event, oldest first. */
function History({ entryId }: { entryId: string }) {
  const t = useTranslations("entry");
  const fmt = useFmt();
  const locale = useLocale();
  const history = useQuery({
    queryKey: keys.entryHistory(entryId),
    queryFn: () => apiGet<EntryHistory>(`/api/v2/ledger/entries/${encodeURIComponent(entryId)}/history`),
  });
  const lines = historyLines(history.data?.events ?? []);
  if (!lines.length) return null;

  const list = (items: string[]) => {
    const [first, ...rest] = items;
    const words = [first, ...rest.map((item) => item.charAt(0).toLocaleLowerCase(locale) + item.slice(1))];
    try {
      return new Intl.ListFormat(locale, { type: "conjunction" }).format(words);
    } catch {
      return words.join(", ");
    }
  };
  const text = (line: HistoryLine): string => {
    switch (line.key) {
      case "imported":
        return line.label ? t("history.imported", { label: line.label }) : t("history.importedPlain");
      case "fromRecurrence":
        return t("history.fromRecurrence", { description: line.description });
      case "installment":
        return t("history.installment", { n: line.n, total: line.total });
      case "duplicated":
        return t("history.duplicated");
      case "created":
        return t("history.created", { by: t(`history.by.${line.actor}`) });
      case "categorizedByRule":
        return t("history.categorizedByRule", { pattern: line.pattern });
      case "categorizedAuto":
        return t("history.categorizedAuto");
      case "updated":
        return line.fields.length === 1
          ? t("history.updatedOne", { field: t(`history.field.${line.fields[0]}`), gender: fieldGender(line.fields[0]), by: t(`history.by.${line.actor}`) })
          : t("history.updatedMany", { fields: list(line.fields.map((field) => t(`history.field.${field}`))), by: t(`history.by.${line.actor}`) });
      case "deleted":
      case "restored":
        return t(`history.${line.key}`, { by: t(`history.by.${line.actor}`) });
    }
  };
  const when = (line: HistoryLine) => {
    if (!line.at) return "";
    return line.time === "dateTime" ? fmt.dateTime(line.at) : line.time === "date" ? fmt.date(line.at) : fmt.relative(line.at);
  };

  return (
    <div className="flex flex-col gap-1 border-t border-stroke-3 pt-2.5">
      <span className="text-[11px] text-fg-3">{t("sheet.history")}</span>
      {lines.map((line, index) => {
        const at = when(line);
        return (
          <span key={index} className="text-[11.5px] text-fg-2">
            · {text(line)}
            {at ? ` · ${at}` : ""}
          </span>
        );
      })}
    </div>
  );
}
