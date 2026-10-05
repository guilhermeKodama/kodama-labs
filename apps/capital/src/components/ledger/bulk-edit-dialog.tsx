"use client";

import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { BulkPreview } from "@capital/server/modules/ledger/services/entries";
import { Btn, Check, Dialog, DialogFooter, DialogHead, Field, Select, Table } from "@/components/cap";
import { AccountCombobox, CategoryCombobox, EntitySelect } from "@/components/pickers";
import { apiPost } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import {
  BULK_EDIT_FIELDS,
  bulkPatch,
  changedRows,
  changes,
  currentValue,
  nextField,
  readyChanges,
  type BulkEditChange,
  type BulkEditField,
  type BulkEditRow,
} from "@/lib/ledger/bulk-edit";
import { cn } from "@/lib/utils";
import type { BulkSelection } from "./bulk-bar";
import type { DisplayRow } from "./rows";

export interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The rows to change: picked ids (transfer legs included) or the whole view's query. */
  selection: BulkSelection;
  /** How many rows the selection has, for the title. */
  count: number;
  names: Names;
  /** After the change was applied (the bar clears the selection). */
  onApplied?: () => void;
  /** The rows as listed, for the before/after table (all the loaded ones when the whole view is selected). */
  rows?: readonly DisplayRow[];
  /** Σ of the selection, for "Somam R$ X". */
  sum?: number;
}

/**
 * "Editar N transações" from the bulk bar (mockup BulkEditDialog
 * 4467-4522): Campo + Novo valor (one or more fields, "+ Outro campo"),
 * before → after per row with "sem mudança", "Criar regra" for a category
 * change, and "Aplicar a N transações", N from a dry run of the whole
 * selection (POST /v2/ledger/bulk {dryRun:true}). Aplicar is one undoable
 * batch.
 */
export function BulkEditDialog(props: BulkEditDialogProps) {
  if (!props.open) return null;
  return <EditDialog {...props} />;
}

function EditDialog({ onOpenChange, selection, count, names, onApplied, rows = [], sum }: BulkEditDialogProps) {
  const t = useTranslations("entry.bulkEdit");
  const tBulk = useTranslations("entry.bulk");
  const fmt = useFmt();
  const [list, setList] = useState<BulkEditChange[]>([{ field: "categoryId", value: "" }]);
  const [rule, setRule] = useState(true);
  const ready = readyChanges(list);
  const patch = bulkPatch(list);
  const learns = rule && ready.some((change) => change.field === "categoryId");
  const body = { op: "update" as const, selection, patch, createRule: learns || undefined };

  const preview = useQuery({
    queryKey: keys.bulkPreview(body),
    queryFn: () => apiPost<BulkPreview>("/api/v2/ledger/bulk", { ...body, dryRun: true }),
    enabled: ready.length > 0,
  });
  const apply = useAppMutation({
    event: "ledger.write",
    mutationFn: () => apiPost<{ batchId: string | null; affected: number; rulesLearned?: number }>("/api/v2/ledger/bulk", body),
    undo: (result) => tBulk("toast.updated", { count: result.affected, rules: result.rulesLearned ?? 0 }),
    onSuccess: () => {
      onApplied?.();
      onOpenChange(false);
    },
  });

  const toChange = ready.length ? (preview.data?.changed ?? changedRows(rows.map(asEditRow), list)) : 0;
  const label = (field: BulkEditField, value: string): string => {
    if (field === "isTaxDeductible") return value === "yes" ? t("yes") : t("no");
    if (!value) return "—";
    if (field === "categoryId") return names.category.get(value) ?? "—";
    if (field === "entityId") return names.entity.get(value) ?? "—";
    return names.account.get(value) ?? "—";
  };

  const valueControl = (change: BulkEditChange, index: number): ReactNode => {
    const set = (value: string) => setList((current) => current.map((item, i) => (i === index ? { ...item, value } : item)));
    switch (change.field) {
      case "categoryId":
        return <CategoryCombobox value={change.value || null} onChange={set} type={["expense", "income"]} className="w-full" />;
      case "entityId":
        return <EntitySelect value={change.value || null} onChange={set} className="w-full" />;
      case "accountId":
        return <AccountCombobox value={change.value || null} onChange={set} types={["checking", "credit_card", "cash"]} className="w-full" />;
      case "isTaxDeductible":
        return (
          <Select
            value={change.value || null}
            onChange={set}
            options={[
              { value: "yes", label: t("yes") },
              { value: "no", label: t("no") },
            ]}
            className="w-full"
          />
        );
    }
  };

  const previewRows = rows.map((row) => {
    const edit = asEditRow(row);
    const moved = ready.filter((change) => changes(edit, change));
    const before = ready.map((change) => label(change.field, currentValue(edit, change.field))).join(" · ");
    const after = moved.length ? ready.map((change) => label(change.field, moved.includes(change) ? change.value : currentValue(edit, change.field))).join(" · ") : null;
    return [
      <span key="d" className="block max-w-[220px] truncate">
        {row.description}
      </span>,
      <span key="b" className={cn(after ? "text-fg-2 line-through" : "text-fg-3")}>
        {ready.length ? before : "—"}
      </span>,
      after ? (
        <span key="a" className="font-medium">
          {after}
        </span>
      ) : (
        <span key="a" className="text-fg-4">
          {t("unchanged")}
        </span>
      ),
    ];
  });

  return (
    <Dialog open onOpenChange={onOpenChange} width={560}>
      <DialogHead title={t("title", { count })} desc={sum !== undefined ? t("desc", { sum: fmt.money(sum, names.currency) }) : undefined} />
      {list.map((change, index) => (
        <div key={`${change.field}:${index}`} className="grid grid-cols-[1fr_1.4fr] items-end gap-2.5">
          <Field label={t("field")}>
            <Select
              value={change.field}
              onChange={(field) => setList((current) => current.map((item, i) => (i === index ? { field: field as BulkEditField, value: "" } : item)))}
              options={BULK_EDIT_FIELDS.filter((field) => field === change.field || !list.some((item) => item.field === field)).map((field) => ({ value: field, label: t(`fields.${field}`) }))}
              className="w-full"
            />
          </Field>
          <span className="flex items-end gap-1.5">
            <Field label={t("value")} className="flex-1">
              {valueControl(change, index)}
            </Field>
            {index > 0 ? (
              <button
                type="button"
                aria-label={t("removeField")}
                title={t("removeField")}
                className="h-[26px] cursor-pointer px-1 text-fg-3 hover:text-fg-1"
                onClick={() => setList((current) => current.filter((_, i) => i !== index))}
              >
                ✕
              </button>
            ) : null}
          </span>
        </div>
      ))}
      {nextField(list) ? (
        <button
          type="button"
          className="w-fit cursor-pointer text-left text-[12px] text-fg-3 hover:text-fg-1"
          onClick={() => {
            const field = nextField(list);
            if (field) setList((current) => [...current, { field, value: "" }]);
          }}
        >
          {t("addField")}
        </button>
      ) : null}
      {rows.length ? (
        <div className="max-h-[260px] overflow-y-auto">
          <Table headers={[t("colTx"), t("colBefore"), t("colAfter")]} rows={previewRows} rowKey={(index) => rows[index].id} />
        </div>
      ) : null}
      {rows.length && rows.length < count ? <p className="text-[11.5px] text-fg-3">{t("partial", { shown: rows.length })}</p> : null}
      {list.some((change) => change.field === "categoryId") ? <Check checked={rule} onChange={setRule} label={t("rule")} /> : null}
      <DialogFooter>
        <Btn ghost onClick={() => onOpenChange(false)}>
          {t("cancel")}
        </Btn>
        <Btn primary disabled={!ready.length || apply.isPending || (toChange === 0 && !learns)} onClick={() => apply.mutate()}>
          {t("apply", { count: toChange })}
        </Btn>
      </DialogFooter>
    </Dialog>
  );
}

function asEditRow(row: DisplayRow): BulkEditRow {
  return {
    id: row.id,
    kind: row.kind,
    description: row.description,
    categoryId: row.categoryId,
    entityId: row.entityId,
    accountId: row.accountId,
    isTaxDeductible: row.isTaxDeductible,
    transferGroupId: row.transferGroupId,
    neutral: row.neutral,
  };
}
