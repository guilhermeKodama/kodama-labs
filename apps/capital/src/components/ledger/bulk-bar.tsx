"use client";

import { Fragment, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Ellipsis, Trash2, X } from "lucide-react";
import type { LedgerSelectionQuery } from "@capital/server/modules/ledger/contracts";
import { Menu, MenuItem, MenuLabel } from "@/components/cap";
import { api, apiPost } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { bulkCategoryGroups } from "@/lib/ledger/bulk-edit";
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
 * slot 4410) instead of covering it. From md up: 40px of bar + 8px gap,
 * over Sonner's zero-specificity :where() rule. Below md the bar is the
 * phone one, fixed at the bottom: --bulk-clearance, which the toaster's
 * offset adds.
 */
const TOASTS_ABOVE_BAR =
  '@media (min-width:768px){:root [data-sonner-toaster][data-y-position="bottom"]{bottom:calc(var(--offset-bottom, 16px) + 48px)}}' +
  "@media (max-width:767.98px){:root{--bulk-clearance:112px}}";

/** A 44px action of the phone bar, on the inverted surface of the toasts. */
const PHONE_ACTION =
  "inline-flex h-11 min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-2 text-button font-medium whitespace-nowrap text-editor outline-none hover:bg-editor/10 focus-visible:bg-editor/15 disabled:opacity-40 data-[state=open]:bg-editor/15";

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
 *
 * On a phone (below md) it is a bar of its own, fixed at the bottom of the
 * screen like iOS's selection toolbar and Material's contextual bar: on the
 * inverted surface of the toasts so it reads as a layer over the table,
 * "✕ N selecionadas" and Σ on top, then Categoria, Entidade, Excluir and ⋯
 * (Editar…, Marcar IR, Duplicar, Exportar). Nothing scrolls sideways.
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
      link.download = "cerne-export.csv";
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
      "inline-flex h-7 cursor-pointer items-center gap-1 rounded-[7px] px-2.5 text-button font-medium whitespace-nowrap outline-none hover:bg-fill-3 focus-visible:bg-fill-3 disabled:opacity-40 data-[state=open]:bg-fill-2",
      danger ? "text-neg" : "text-fg-1",
    );
  const btn = (label: string, onClick: () => void, danger?: boolean) => (
    <button type="button" onClick={onClick} disabled={bulk.isPending} className={btnClass(danger)}>
      {label}
    </button>
  );
  const categoryGroups = bulkCategoryGroups(names.categories);
  const selectedLabel = allInView ? t("selectedAll", { count }) : t("selected", { count });
  const sum = allInView ? totalSumInView : stats.sum;
  const tax = () => run({ op: "update", patch: { toggleTaxDeductible: true } }, (affected) => t("toast.tax", { count: affected }));
  const categoryMenu = (trigger: ReactNode) => (
    <Menu side="top" align="center" width={220} trigger={trigger}>
      <MenuLabel>{t("categoryTitle", { count })}</MenuLabel>
      <div className="max-h-[220px] overflow-y-auto">
        {categoryGroups.map((group) => (
          <Fragment key={group.type}>
            <MenuLabel>{t(`categoryGroup.${group.type}`)}</MenuLabel>
            {group.categories.map((category) => (
              <MenuItem
                key={category.id}
                label={category.name}
                onSelect={() => run({ op: "update", patch: { categoryId: category.id } }, (affected) => t("toast.category", { count: affected, category: category.name }))}
              />
            ))}
          </Fragment>
        ))}
      </div>
    </Menu>
  );
  const entityMenu = (trigger: ReactNode) => (
    <Menu side="top" align="center" width={220} trigger={trigger}>
      <MenuLabel>{t("entityTitle", { count })}</MenuLabel>
      {names.entities.map((entity) => (
        <MenuItem
          key={entity.id}
          label={names.entity.get(entity.id)}
          onSelect={() => run({ op: "update", patch: { entityId: entity.id } }, (affected) => t("toast.entity", { count: affected, entity: names.entity.get(entity.id) ?? "" }))}
        />
      ))}
    </Menu>
  );

  return (
    <>
      <style>{TOASTS_ABOVE_BAR}</style>
      <div className="pointer-events-none sticky bottom-4 z-[35] mt-2 flex flex-col items-center gap-2 max-md:hidden">
        <div className="pointer-events-auto relative flex flex-wrap items-center justify-center gap-1 rounded-[12px] border border-stroke-1 bg-chrome p-[5px] text-button">
          <span className="inline-flex h-7 items-center gap-2 rounded-[7px] border border-dashed border-stroke-1 pr-1.5 pl-2.5 font-semibold whitespace-nowrap">
            {selectedLabel}
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
          {categoryMenu(<button type="button" className={btnClass()}>{t("category")}</button>)}
          {entityMenu(<button type="button" className={btnClass()}>{t("entity")}</button>)}
          {btn(t("tax"), tax)}
          {btn(t("duplicate"), duplicate)}
          {btn(t("export"), () => exportCsv.mutate())}
          <span className="h-5 w-px bg-stroke-2" />
          {btn(t("delete"), remove, true)}
        </div>
      </div>
      <div
        role="toolbar"
        aria-label={selectedLabel}
        data-bulk-bar="phone"
        className="fixed inset-x-0 bottom-[calc(-1*var(--screen-below-viewport,0px))] z-[35] flex flex-col gap-1 rounded-t-[16px] bg-fg-1 px-3 pt-1.5 pb-[calc(8px+var(--safe-bottom))] text-editor shadow-lg md:hidden"
      >
        <div className="flex h-11 items-center gap-1">
          <button type="button" aria-label={t("clear")} onClick={onClear} className={cn(PHONE_ACTION, "-ml-1 w-11 shrink-0 px-0")}>
            <X aria-hidden className="size-5" />
          </button>
          <span className="min-w-0 truncate text-body font-semibold">{selectedLabel}</span>
          {sum !== undefined ? (
            <span className="ml-auto shrink-0 pl-2 font-mono text-body tabular-nums">
              <span className="text-editor/60">{t("sum")}</span> {fmt.money(sum, cur)}
            </span>
          ) : null}
        </div>
        <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-1">
          {categoryMenu(
            <button type="button" disabled={bulk.isPending} className={PHONE_ACTION}>
              {t("category")}
            </button>,
          )}
          {entityMenu(
            <button type="button" disabled={bulk.isPending} className={PHONE_ACTION}>
              {t("entity")}
            </button>,
          )}
          <button type="button" onClick={remove} disabled={bulk.isPending} className={PHONE_ACTION}>
            <Trash2 aria-hidden className="size-4 shrink-0" />
            {t("delete")}
          </button>
          <Menu
            side="top"
            align="end"
            width={200}
            trigger={
              <button type="button" aria-label={t("more")} title={t("more")} disabled={bulk.isPending} className={cn(PHONE_ACTION, "w-11 px-0")}>
                <Ellipsis aria-hidden className="size-5" />
              </button>
            }
          >
            <MenuItem label={t("edit")} onSelect={() => setEditing(true)} />
            <MenuItem label={t("tax")} onSelect={tax} />
            <MenuItem label={t("duplicate")} onSelect={duplicate} />
            <MenuItem label={t("export")} onSelect={() => exportCsv.mutate()} />
          </Menu>
        </div>
      </div>
      <BulkEditDialog open={editing} onOpenChange={setEditing} selection={selection} count={count} names={names} rows={rows} sum={sum} />
    </>
  );
}
