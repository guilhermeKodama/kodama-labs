"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { LedgerSelectionQuery } from "@capital/server/modules/ledger/contracts";
import { Menu, MenuItem, MenuLabel } from "@/components/cap";
import { api, apiPost } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { useShortcut } from "@/lib/shortcuts/provider";
import { cn } from "@/lib/utils";
import { BulkEditDialog } from "./bulk-edit-dialog";
import type { DisplayRow } from "./rows";

export interface BulkStats {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

/** What a bulk change acts on: the picked rows (every leg of a transfer) or all the view's query matches. */
export type BulkSelection = { ids: string[] } | { query: LedgerSelectionQuery };

export interface BulkBarProps {
  selection: BulkSelection;
  /** Σ, média, mín, máx of the picked rows. */
  stats: BulkStats;
  names: Names;
  /** The whole view is selected ("Selecionar todas as N"). */
  allInView: boolean;
  /** Offer "Selecionar todas as N": every loaded row is picked and the view has more. (The table's banner offers it.) */
  canSelectAll: boolean;
  totalInView: number;
  onSelectAll: () => void;
  /** Clears the selection; also called after a bulk delete went through. */
  onClear: () => void;
  /** The picked rows as listed, for the before/after preview of "Editar…". */
  rows?: readonly DisplayRow[];
  /** Σ of the whole view, shown when it is all selected. */
  totalSumInView?: number;
}

/**
 * Lifts the bottom-center toaster (ui/sonner.tsx, 16px offset) over the
 * bar while it is up, so result toasts stack above it (mockup BulkBar toast
 * slot 4410) instead of covering it: 40px of bar + 8px gap. Sonner places
 * the toaster with a zero-specificity :where() rule (and a 2-attribute one
 * under 600px), which this outranks.
 */
const TOASTS_ABOVE_BAR =
  ':root [data-sonner-toaster][data-y-position="bottom"]{bottom:calc(var(--offset-bottom, 16px) + 48px)}' +
  '@media (max-width:600px){:root [data-sonner-toaster][data-y-position="bottom"]{bottom:calc(var(--mobile-offset-bottom, 16px) + 48px)}}';

interface BulkRequest {
  body: Record<string, unknown>;
  /** Toast for the change, from the number of rows it touched. */
  message: (affected: number) => string;
}

/**
 * The floating bar over a table selection (mockup BulkBar 4347-4465):
 * "N selecionadas ✕", Σ / média / mín / máx (Σ of the view when it is all
 * selected), Editar… (BulkEditDialog), Categoria ▾, Entidade ▾, Marcar IR,
 * Duplicar, Exportar and Excluir. Each change is one undoable POST
 * /v2/ledger/bulk whose toast stacks above the bar; the selection stays
 * except after Excluir (deleteMode "undo": no confirmation). Esc clears,
 * ⌫ deletes and ⌘D duplicates the selection.
 */
export function BulkBar({ selection, stats, names, allInView, totalInView, onClear, rows, totalSumInView }: BulkBarProps) {
  const t = useTranslations("entry.bulk");
  const fmt = useFmt();
  const [editing, setEditing] = useState(false);
  const count = allInView ? totalInView : stats.count;
  const bulk = useAppMutation({
    event: "ledger.write",
    mutationFn: ({ body }: BulkRequest) => apiPost<{ batchId: string | null; affected: number }>("/api/v2/ledger/bulk", { ...body, selection }),
    undo: (result, request) => request.message(result.affected),
    // As in the mockup, the selection stays up after a change (its toast stacks above the bar); a delete clears it.
    onSuccess: (_result, request) => request.body.op === "delete" && onClear(),
  });
  const exportCsv = useAppMutation({
    event: null,
    mutationFn: async () => {
      const body = "ids" in selection ? { ids: selection.ids } : { query: selection.query };
      const csv = await api<string>("/api/v2/ledger/export", { method: "POST", body: JSON.stringify(body) });
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "capital-export.csv";
      link.click();
      URL.revokeObjectURL(url);
    },
    undo: () => t("toast.export", { count }),
  });
  const run = (body: Record<string, unknown>, message: BulkRequest["message"]) => !bulk.isPending && bulk.mutate({ body, message });
  const remove = () => run({ op: "delete" }, () => t("toast.delete", { count }));
  const duplicate = () => run({ op: "duplicate" }, () => t("toast.duplicate", { count }));

  useShortcut("escape", () => onClear());
  useShortcut(["backspace", "delete"], () => remove());
  useShortcut("mod+d", () => duplicate());

  const cur = names.currency;
  const stat = (label: string, value: number) => (
    <span className="whitespace-nowrap text-fg-3">
      {label} <span className="font-mono text-fg-1 tabular-nums">{fmt.money(value, cur)}</span>
    </span>
  );
  const btnClass = (danger?: boolean) =>
    cn(
      "inline-flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-[12px] font-medium whitespace-nowrap outline-none hover:bg-fill-3 focus-visible:bg-fill-3 disabled:opacity-40 data-[state=open]:bg-fill-2",
      danger ? "text-neg" : "text-fg-1",
    );
  const btn = (label: string, onClick: () => void, danger?: boolean) => (
    <button type="button" onClick={onClick} disabled={bulk.isPending} className={btnClass(danger)}>
      {label}
    </button>
  );
  const categories = names.categories
    .filter((category) => !category.isArchived && category.type !== "investment")
    .sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === "expense" ? -1 : 1));

  return (
    <div className="pointer-events-none sticky bottom-4 z-[35] mt-2 flex flex-col items-center gap-2">
      <style>{TOASTS_ABOVE_BAR}</style>
      <div className="pointer-events-auto relative flex flex-wrap items-center justify-center gap-1 rounded-[12px] border border-stroke-1 bg-chrome p-[5px] text-[12px]">
        <span className="inline-flex h-7 items-center gap-2 rounded-[7px] border border-dashed border-stroke-1 pr-1.5 pl-2.5 font-semibold whitespace-nowrap">
          {allInView ? t("selectedAll", { count }) : t("selected", { count })}
          <button type="button" title={t("clear")} aria-label={t("clear")} className="cursor-pointer font-normal text-fg-3 outline-none hover:text-fg-1" onClick={onClear}>
            ✕
          </button>
        </span>
        <span className="inline-flex gap-3 px-2.5">
          {allInView ? (
            totalSumInView !== undefined ? stat(t("sum"), totalSumInView) : null
          ) : (
            <>
              {stat(t("sum"), stats.sum)}
              {stats.count > 1 ? stat(t("avg"), stats.avg) : null}
              {stats.count > 1 ? stat(t("min"), stats.min) : null}
              {stats.count > 1 ? stat(t("max"), stats.max) : null}
            </>
          )}
        </span>
        <span className="h-5 w-px bg-stroke-2" />
        {btn(t("edit"), () => setEditing(true))}
        <Menu side="top" align="center" width={220} trigger={<button type="button" className={btnClass()}>{t("category")}</button>}>
          <MenuLabel>{t("categoryTitle", { count })}</MenuLabel>
          <div className="max-h-[220px] overflow-y-auto">
            {categories.map((category) => (
              <MenuItem
                key={category.id}
                label={category.name}
                onSelect={() => run({ op: "update", patch: { categoryId: category.id } }, (affected) => t("toast.category", { count: affected, category: category.name }))}
              />
            ))}
          </div>
        </Menu>
        <Menu side="top" align="center" width={220} trigger={<button type="button" className={btnClass()}>{t("entity")}</button>}>
          <MenuLabel>{t("entityTitle", { count })}</MenuLabel>
          {names.entities.map((entity) => (
            <MenuItem
              key={entity.id}
              label={names.entity.get(entity.id)}
              onSelect={() => run({ op: "update", patch: { entityId: entity.id } }, (affected) => t("toast.entity", { count: affected, entity: names.entity.get(entity.id) ?? "" }))}
            />
          ))}
        </Menu>
        {btn(t("tax"), () => run({ op: "update", patch: { toggleTaxDeductible: true } }, (affected) => t("toast.tax", { count: affected })))}
        {btn(t("duplicate"), duplicate)}
        {btn(t("export"), () => exportCsv.mutate())}
        <span className="h-5 w-px bg-stroke-2" />
        {btn(t("delete"), remove, true)}
      </div>
      <BulkEditDialog
        open={editing}
        onOpenChange={setEditing}
        selection={selection}
        count={count}
        names={names}
        rows={rows}
        sum={allInView ? totalSumInView : stats.sum}
      />
    </div>
  );
}
