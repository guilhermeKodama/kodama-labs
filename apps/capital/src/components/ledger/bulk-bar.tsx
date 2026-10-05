"use client";

import { useState } from "react";
import type { Names } from "@/lib/api/catalog";
import { money } from "@/lib/money";
import { Check, MenuItem, MenuLabel, Popover } from "@/components/shell/chrome";

export interface BulkStats {
  count: number;
  sum: number;
  avg: number;
  min: number;
  max: number;
}

export function BulkBar({
  stats,
  names,
  allInView,
  canSelectAll,
  totalInView,
  onSelectAll,
  onClear,
  onCategory,
  onEntity,
  onToggleTax,
  onDuplicate,
  onDelete,
}: {
  stats: BulkStats;
  names: Names;
  allInView: boolean;
  canSelectAll: boolean;
  totalInView: number;
  onSelectAll: () => void;
  onClear: () => void;
  onCategory: (categoryId: string | null, createRule: boolean) => void;
  onEntity: (entityId: string) => void;
  onToggleTax: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [pop, setPop] = useState<"cat" | "ent" | null>(null);
  const [rule, setRule] = useState(false);
  const cur = names.currency;
  const btn = (label: string, onClick: () => void, danger?: boolean) => (
    <button type="button" onClick={onClick} className={`inline-flex h-7 items-center rounded-[7px] px-2.5 text-[12px] font-medium whitespace-nowrap hover:bg-fill-2/70 ${danger ? "text-neg" : ""}`}>
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
            <MenuItem label="Sem categoria" onClick={() => { onCategory(null, false); setPop(null); }} />
            {names.categories
              .filter((c) => !c.isArchived)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <MenuItem key={c.id} label={c.name} hint={c.type === "income" ? "entrada" : c.type === "investment" ? "invest." : undefined} onClick={() => { onCategory(c.id, rule); setPop(null); }} />
              ))}
          </Popover>
        </span>
        <span className="relative">
          {btn("Entidade ▾", () => setPop(pop === "ent" ? null : "ent"))}
          <Popover open={pop === "ent"} onClose={() => setPop(null)} up width={220}>
            <MenuLabel>Mover para a conta principal de</MenuLabel>
            {names.entities.map((e) => (
              <MenuItem key={e.id} label={names.entity.get(e.id)} onClick={() => { onEntity(e.id); setPop(null); }} />
            ))}
          </Popover>
        </span>
        {btn("Marcar IR", onToggleTax)}
        {btn("Duplicar", onDuplicate)}
        <span className="h-5 w-px bg-stroke-1" />
        {btn("Excluir", onDelete, true)}
      </div>
    </div>
  );
}
