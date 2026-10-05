"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { LedgerSelectionQuery } from "@capital/server/modules/ledger/contracts";
import { apiPost } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { money } from "@/lib/money";
import { Check, MenuItem, MenuLabel, Popover } from "@/components/shell/chrome";

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
  /** Offer "Selecionar todas as N": every loaded row is picked and the view has more. */
  canSelectAll: boolean;
  totalInView: number;
  onSelectAll: () => void;
  /** Clears the selection; also called after a change went through. */
  onClear: () => void;
}

interface BulkRequest {
  body: Record<string, unknown>;
  /** Toast for the change, from the number of rows it touched. */
  message: (affected: number) => string;
}

/**
 * The floating bar over a table selection: count, Σ/média/mín/máx and the
 * bulk changes (POST /v2/ledger/bulk, one undoable batch each).
 *
 * OWNER: S2. Target (mockup 5541-5545): "Editar…" (BulkEditDialog),
 * "Exportar" (POST /v2/ledger/export {ids}), the scope question when the
 * selection holds repeating rows, ⌫ and ⌘D on the selection, "Esc limpa".
 * Now: category (with "criar regra"), entity, IR flag, duplicate and
 * delete, as before 0c-3, owned here instead of in TransactionsScreen.
 */
export function BulkBar({ selection, stats, names, allInView, canSelectAll, totalInView, onSelectAll, onClear }: BulkBarProps) {
  const t = useTranslations("entry.bulk");
  const [pop, setPop] = useState<"cat" | "ent" | null>(null);
  const [rule, setRule] = useState(false);
  const bulk = useAppMutation({
    event: "ledger.write",
    mutationFn: ({ body }: BulkRequest) => apiPost<{ batchId: string | null; affected: number }>("/api/v2/ledger/bulk", { ...body, selection }),
    undo: (result, request) => request.message(result.affected),
    onSuccess: () => onClear(),
  });
  const run = (body: Record<string, unknown>, message: BulkRequest["message"]) => bulk.mutate({ body, message });
  const selected = allInView ? totalInView : stats.count;
  const cur = names.currency;
  const btn = (label: string, onClick: () => void, danger?: boolean) => (
    <button
      type="button"
      onClick={onClick}
      disabled={bulk.isPending}
      className={`inline-flex h-7 items-center rounded-[7px] px-2.5 text-[12px] font-medium whitespace-nowrap hover:bg-fill-2/70 disabled:opacity-40 ${danger ? "text-neg" : ""}`}
    >
      {label}
    </button>
  );
  return (
    <div className="pointer-events-none sticky bottom-2 z-20 flex justify-center">
      <div className="pointer-events-auto relative flex flex-wrap items-center justify-center gap-1 rounded-xl border border-stroke-1 bg-chrome p-1.5 text-[12px] shadow-lg">
        <span className="inline-flex h-7 items-center gap-2 rounded-[7px] border border-dashed border-fg-3 px-2.5 font-semibold whitespace-nowrap">
          {allInView ? `${totalInView} selecionadas (toda a view)` : `${stats.count} selecionadas`}
          <button type="button" title="Limpar seleção" className="font-normal text-fg-3 hover:text-fg-strong" onClick={onClear}>✕</button>
        </span>
        {canSelectAll && !allInView ? btn(`Selecionar todas as ${totalInView}`, onSelectAll) : null}
        {!allInView ? (
          <span className="inline-flex gap-3 px-2.5 whitespace-nowrap text-fg-3">
            <span>Σ <span className="font-mono text-fg-1 tabular-nums">{money(stats.sum, cur)}</span></span>
            {stats.count > 1 ? <span>média <span className="font-mono text-fg-1 tabular-nums">{money(stats.avg, cur)}</span></span> : null}
            {stats.count > 1 ? <span>mín <span className="font-mono text-fg-1 tabular-nums">{money(stats.min, cur)}</span></span> : null}
            {stats.count > 1 ? <span>máx <span className="font-mono text-fg-1 tabular-nums">{money(stats.max, cur)}</span></span> : null}
          </span>
        ) : null}
        <span className="h-5 w-px bg-stroke-1" />
        <span className="relative">
          {btn("Categoria ▾", () => setPop(pop === "cat" ? null : "cat"))}
          <Popover open={pop === "cat"} onClose={() => setPop(null)} up width={240}>
            <MenuLabel>Mudar categoria</MenuLabel>
            <div className="px-2 pb-1"><Check checked={rule} onChange={setRule} label="Criar regra pelas descrições" /></div>
            <MenuItem
              label="Sem categoria"
              onClick={() => {
                run({ op: "update", patch: { categoryId: null } }, (count) => t("category", { count }));
                setPop(null);
              }}
            />
            {names.categories
              .filter((c) => !c.isArchived)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <MenuItem
                  key={c.id}
                  label={c.name}
                  hint={c.type === "income" ? "entrada" : c.type === "investment" ? "invest." : undefined}
                  onClick={() => {
                    run({ op: "update", patch: { categoryId: c.id }, createRule: rule }, (count) => t("category", { count }));
                    setPop(null);
                  }}
                />
              ))}
          </Popover>
        </span>
        <span className="relative">
          {btn("Entidade ▾", () => setPop(pop === "ent" ? null : "ent"))}
          <Popover open={pop === "ent"} onClose={() => setPop(null)} up width={220}>
            <MenuLabel>Mover para a conta principal de</MenuLabel>
            {names.entities.map((e) => (
              <MenuItem
                key={e.id}
                label={names.entity.get(e.id)}
                onClick={() => {
                  run({ op: "update", patch: { entityId: e.id } }, (count) => t("entity", { entity: names.entity.get(e.id) ?? "", count }));
                  setPop(null);
                }}
              />
            ))}
          </Popover>
        </span>
        {btn("Marcar IR", () => run({ op: "update", patch: { toggleTaxDeductible: true } }, (count) => t("tax", { count })))}
        {btn("Duplicar", () => run({ op: "duplicate" }, (count) => t("duplicate", { count })))}
        <span className="h-5 w-px bg-stroke-1" />
        {btn(
          "Excluir",
          () => {
            if (selected > 20 && !window.confirm(t("confirmDelete", { count: selected }))) return;
            run({ op: "delete" }, (count) => t("delete", { count }));
          },
          true,
        )}
      </div>
    </div>
  );
}
