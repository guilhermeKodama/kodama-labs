"use client";

import { useState } from "react";
import type { LedgerFilter, ViewConfig } from "@capital/server/modules/ledger/contracts";
import type { Names } from "@/lib/api/catalog";
import { monthLabel } from "@/lib/money";
import { Btn, Check, Field, MenuItem, MenuLabel, Popover, SelectInput, TextInput } from "@/components/shell/chrome";
import {
  COLUMN_LABEL,
  COLUMN_ORDER,
  FIELD_LABEL,
  FILTERABLE,
  GROUP_OPTIONS,
  PERIOD_LABEL,
  SORTS,
  fieldOptions,
  filterLabel,
  groupKeyFromId,
  groupKeyId,
  groupLabel,
  sortKey,
  type CategoricalField,
} from "./fields";

const PRESETS = ["this_month", "last_month", "last_3m", "ytd", "last_12m", "all"] as const;

/** Label for the resolved range the server used, e.g. "out/2026" or "jan/2026 – out/2026". */
export function rangeLabel(range: { from: string | null; to: string | null } | undefined, preset: string): string {
  if (!range?.from || !range.to) return PERIOD_LABEL[preset] ?? "";
  if (range.from.slice(0, 7) === range.to.slice(0, 7)) return monthLabel(range.from);
  if (range.from.slice(0, 4) === range.to.slice(0, 4) && range.from.slice(5) === "01-01") return range.from.slice(0, 4);
  return `${monthLabel(range.from)} – ${monthLabel(range.to)}`;
}

export function PeriodControl({
  config,
  label,
  onChange,
}: {
  config: ViewConfig;
  label: string;
  onChange: (period: ViewConfig["period"]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const period = config.period;
  const preset = "preset" in period ? period.preset : null;
  const offset = "preset" in period ? period.offset : 0;
  const steppable = preset !== null && preset !== "all";
  return (
    <span className="relative inline-flex h-[26px] shrink-0 items-center rounded-[6px] border border-stroke-1 bg-editor text-[12px]">
      {steppable ? (
        <button type="button" title="Período anterior" className="h-full border-r border-stroke-3 px-1.5 text-fg-2 hover:bg-fill-4" onClick={() => onChange({ preset: preset!, offset: offset - 1 })}>
          ‹
        </button>
      ) : null}
      <button type="button" className="flex h-full items-center gap-1.5 px-2 whitespace-nowrap hover:bg-fill-4" onClick={() => setOpen((v) => !v)}>
        <span className="text-fg-3">{preset ? PERIOD_LABEL[preset] : "Intervalo"}</span>
        {preset !== "all" ? <span className="font-medium">{label}</span> : null}
      </button>
      {steppable ? (
        <button
          type="button"
          title="Próximo período"
          disabled={offset >= 0}
          className="h-full border-l border-stroke-3 px-1.5 text-fg-2 hover:bg-fill-4 disabled:text-fg-4"
          onClick={() => onChange({ preset: preset!, offset: offset + 1 })}
        >
          ›
        </button>
      ) : null}
      <Popover open={open} onClose={() => setOpen(false)} width={250}>
        <MenuLabel>Período da view</MenuLabel>
        {PRESETS.map((p) => (
          <MenuItem key={p} label={PERIOD_LABEL[p]} active={preset === p} hint={preset === p ? "✓" : undefined} onClick={() => { onChange({ preset: p, offset: 0 }); setOpen(false); }} />
        ))}
        <MenuLabel>Intervalo personalizado</MenuLabel>
        <div className="flex items-center gap-1 px-1 pb-1">
          <TextInput type="date" value={from} onChange={setFrom} className="w-[104px]" />
          <TextInput type="date" value={to} onChange={setTo} className="w-[104px]" />
        </div>
        <div className="px-1 pb-1">
          <Btn primary disabled={!from || !to || from > to} onClick={() => { onChange({ from, to }); setOpen(false); }}>
            Aplicar
          </Btn>
        </div>
      </Popover>
      {offset !== 0 ? (
        <button type="button" className="absolute top-full left-0 mt-0.5 text-[11px] whitespace-nowrap text-fg-3 underline" onClick={() => onChange({ preset: preset!, offset: 0 })}>
          voltar para o atual
        </button>
      ) : null}
    </span>
  );
}

export function FilterChips({
  filters,
  names,
  onChange,
}: {
  filters: LedgerFilter[];
  names: Names;
  onChange: (filters: LedgerFilter[]) => void;
}) {
  const [editing, setEditing] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [pendingField, setPendingField] = useState<CategoricalField | null>(null);
  const [pendingValues, setPendingValues] = useState<(string | boolean)[]>([]);

  function closeAdd() {
    setAdding(false);
    setPendingField(null);
    setPendingValues([]);
  }

  function setAt(index: number, filter: LedgerFilter | null) {
    const next = [...filters];
    if (filter) next[index] = filter;
    else next.splice(index, 1);
    onChange(next);
  }

  return (
    <>
      {filters.map((filter, index) => (
        <span key={index} className="relative inline-flex h-6 shrink-0 items-center overflow-hidden rounded-[6px] border border-stroke-1 bg-fill-4 text-[12px]">
          <button type="button" className="h-full max-w-[280px] truncate px-2 hover:bg-fill-3" onClick={() => setEditing(editing === index ? null : index)}>
            {filterLabel(filter, names)}
          </button>
          <button type="button" title="Remover filtro" className="h-full border-l border-stroke-3 px-1.5 text-fg-3 hover:text-fg-strong" onClick={() => setAt(index, null)}>
            ✕
          </button>
          {editing === index ? (
            <FilterEditor filter={filter} names={names} onClose={() => setEditing(null)} onChange={(f) => setAt(index, f)} />
          ) : null}
        </span>
      ))}
      <span className="relative">
        <Btn dashed onClick={() => (adding ? closeAdd() : setAdding(true))}>+ Filtro</Btn>
        <Popover open={adding} onClose={closeAdd} width={pendingField ? 260 : 220}>
          {pendingField ? (
            <>
              <MenuLabel>{FIELD_LABEL[pendingField]} é…</MenuLabel>
              {fieldOptions(pendingField, names).map((option) => (
                <label key={String(option.value)} className="flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-2 hover:bg-fill-3">
                  <input
                    type="checkbox"
                    className="size-3.5 accent-fg-ink"
                    checked={pendingValues.includes(option.value)}
                    onChange={(event) => setPendingValues(event.target.checked ? [...pendingValues, option.value] : pendingValues.filter((v) => v !== option.value))}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              ))}
              <div className="flex gap-1 px-1 pt-1">
                <Btn primary disabled={!pendingValues.length} onClick={() => { onChange([...filters, { field: pendingField, op: "in", values: pendingValues } as LedgerFilter]); closeAdd(); }}>
                  Aplicar
                </Btn>
                <Btn ghost onClick={() => { setPendingField(null); setPendingValues([]); }}>Voltar</Btn>
              </div>
            </>
          ) : (
            <>
              <MenuLabel>Filtrar por…</MenuLabel>
              {FILTERABLE.map((field) => (
                <MenuItem key={field} label={FIELD_LABEL[field]} onClick={() => setPendingField(field)} />
              ))}
              <MenuItem label="Sem categoria" onClick={() => { onChange([...filters, { field: "categoryId", op: "isNull" }]); closeAdd(); }} />
              <MenuItem label="Valor…" onClick={() => { onChange([...filters, { field: "amountBase", op: "lte", value: -100 }]); closeAdd(); setEditing(filters.length); }} />
              <MenuItem label="Descrição contém…" onClick={() => { closeAdd(); setEditing(-1); }} />
            </>
          )}
        </Popover>
        {editing === -1 ? (
          <FilterEditor
            filter={{ field: "description", op: "contains", value: " " }}
            names={names}
            onClose={() => setEditing(null)}
            onChange={(f) => onChange([...filters, f])}
          />
        ) : null}
      </span>
    </>
  );
}

function FilterEditor({ filter, names, onChange, onClose }: { filter: LedgerFilter; names: Names; onChange: (f: LedgerFilter) => void; onClose: () => void }) {
  const [text, setText] = useState(filter.op === "contains" ? filter.value.trim() : "");
  const [num, setNum] = useState("value" in filter && typeof filter.value === "number" ? String(Math.abs(filter.value)) : "");
  const [numOp, setNumOp] = useState<string>(filter.field === "amountBase" && "value" in filter && typeof filter.value === "number" ? (filter.value < 0 || filter.op === "lt" || filter.op === "lte" ? "out_gt" : "in_gt") : "out_gt");

  if (filter.op === "in" || filter.op === "nin") {
    const field = filter.field as CategoricalField;
    const values = filter.values;
    return (
      <Popover open onClose={onClose} width={260}>
        <MenuLabel>{FIELD_LABEL[field]}</MenuLabel>
        <div className="flex gap-1 px-1 pb-1">
          <Btn ghost onClick={() => onChange({ ...filter, op: filter.op === "in" ? "nin" : "in" })}>{filter.op === "in" ? "é" : "não é"} ⇄</Btn>
        </div>
        {fieldOptions(field, names).map((option) => {
          const on = values.includes(option.value);
          return (
            <label key={String(option.value)} className="flex h-7 cursor-pointer items-center gap-2 rounded-[5px] px-2 hover:bg-fill-3">
              <input
                type="checkbox"
                className="size-3.5 accent-fg-ink"
                checked={on}
                onChange={(event) => {
                  const next = event.target.checked ? [...values, option.value] : values.filter((v) => v !== option.value);
                  if (next.length) onChange({ ...filter, values: next });
                }}
              />
              <span className="truncate">{option.label}</span>
            </label>
          );
        })}
        <div className="px-1 pt-1"><Btn primary onClick={onClose}>Pronto</Btn></div>
      </Popover>
    );
  }
  if (filter.op === "contains") {
    return (
      <Popover open onClose={onClose} width={240}>
        <MenuLabel>Descrição contém</MenuLabel>
        <form className="flex gap-1 px-1 pb-1" onSubmit={(event) => { event.preventDefault(); if (text.trim()) onChange({ field: "description", op: "contains", value: text.trim() }); onClose(); }}>
          <TextInput autoFocus value={text} onChange={setText} className="flex-1" />
          <Btn primary type="submit">OK</Btn>
        </form>
      </Popover>
    );
  }
  if (filter.field === "amountBase") {
    return (
      <Popover open onClose={onClose} width={260}>
        <MenuLabel>Valor</MenuLabel>
        <form
          className="flex flex-col gap-1.5 px-1 pb-1"
          onSubmit={(event) => {
            event.preventDefault();
            const value = Number(num.replace(",", "."));
            if (!Number.isFinite(value)) return;
            const next: LedgerFilter =
              numOp === "out_gt" ? { field: "amountBase", op: "lte", value: -value } :
              numOp === "out_lt" ? { field: "amountBase", op: "between", min: -value, max: 0 } :
              numOp === "in_gt" ? { field: "amountBase", op: "gte", value } :
              { field: "amountBase", op: "between", min: 0, max: value };
            onChange(next);
            onClose();
          }}
        >
          <SelectInput
            value={numOp}
            onChange={setNumOp}
            options={[
              { value: "out_gt", label: "Saídas acima de" },
              { value: "out_lt", label: "Saídas até" },
              { value: "in_gt", label: "Entradas acima de" },
              { value: "in_lt", label: "Entradas até" },
            ]}
          />
          <div className="flex gap-1">
            <TextInput autoFocus mono value={num} onChange={setNum} placeholder="500" className="flex-1" />
            <Btn primary type="submit">OK</Btn>
          </div>
        </form>
      </Popover>
    );
  }
  return null;
}

export function DisplayMenu({
  open,
  onClose,
  name,
  isBuiltin,
  isFavorite,
  config,
  onRename,
  onFavorite,
  onConfig,
  onDuplicate,
  onDelete,
  onExport,
}: {
  open: boolean;
  onClose: () => void;
  name: string;
  isBuiltin: boolean;
  isFavorite: boolean;
  config: ViewConfig;
  onRename: (name: string) => void;
  onFavorite: (value: boolean) => void;
  onConfig: (patch: Partial<ViewConfig>) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onExport: () => void;
}) {
  const [draftName, setDraftName] = useState(name);
  const g1 = groupKeyId(config.groupBy[0]);
  const g2 = groupKeyId(config.groupBy[1]);
  const setGroups = (a: string, b: string) => {
    const keys = [groupKeyFromId(a), a === "none" ? null : groupKeyFromId(b)].filter(Boolean) as ViewConfig["groupBy"];
    onConfig({ groupBy: keys });
  };
  const chart = config.chart;
  const groupTitle = config.layout === "pivot" ? "Linhas" : config.layout === "chart" ? "Eixo" : config.layout === "board" ? "Colunas" : "Agrupar por";
  const subTitle = config.layout === "pivot" ? "Colunas" : "Sub-agrupar";
  return (
    <Popover open={open} onClose={onClose} align="right" width={340}>
      <div className="flex flex-col gap-2.5 p-1.5">
        <Field label="Nome" hint={isBuiltin ? "View fixa. Filtros aqui são temporários; colunas, ordenação, cálculos e layout ficam lembrados." : undefined}>
          <form className="flex gap-1" onSubmit={(event) => { event.preventDefault(); if (draftName.trim()) onRename(draftName.trim()); }}>
            <TextInput value={draftName} onChange={setDraftName} className="flex-1" />
            {!isBuiltin ? <Btn type="submit" disabled={draftName.trim() === name}>Renomear</Btn> : null}
          </form>
        </Field>
        <Field label="Layout">
          <div className="grid grid-cols-5 gap-1">
            {(["table", "pivot", "chart", "board", "calendar"] as const).map((layout) => (
              <button
                key={layout}
                type="button"
                onClick={() => onConfig({ layout, ...(layout === "pivot" && config.groupBy.length < 2 ? { groupBy: [{ field: "categoryId" }, { field: "entityId" }] } : {}), ...(layout === "board" && config.groupBy.length === 0 ? { groupBy: [{ field: "accountId" }] } : {}), ...(layout === "chart" && config.groupBy.length === 0 ? { groupBy: [{ field: "categoryId" }] } : {}) })}
                className={`flex flex-col items-center gap-0.5 rounded-[6px] border py-1.5 text-[10.5px] ${config.layout === layout ? "border-fg-ink text-fg-1" : "border-stroke-3 text-fg-3"}`}
              >
                <span className="text-[13px]">{{ table: "▦", pivot: "▤", chart: "▮", board: "▥", calendar: "▣" }[layout]}</span>
                {{ table: "Tabela", pivot: "Pivot", chart: "Gráfico", board: "Board", calendar: "Calendário" }[layout]}
              </button>
            ))}
          </div>
        </Field>
        {config.layout !== "calendar" ? (
          <Field label={groupTitle}>
            <SelectInput value={g1} onChange={(v) => setGroups(v, g2)} options={GROUP_OPTIONS.map((id) => ({ value: id, label: groupLabel(id) }))} />
          </Field>
        ) : null}
        {(config.layout === "table" || config.layout === "pivot") && g1 !== "none" ? (
          <Field label={subTitle}>
            <SelectInput value={g2} onChange={(v) => setGroups(g1, v)} options={GROUP_OPTIONS.filter((id) => id !== g1).map((id) => ({ value: id, label: groupLabel(id) }))} />
          </Field>
        ) : null}
        {config.layout === "chart" ? (
          <>
            <Field label="Tipo de gráfico">
              <div className="grid grid-cols-3 gap-1">
                {(["bar", "hbar", "line", "area", "pie", "donut", "sankey"] as const).map((type) => (
                  <button key={type} type="button" onClick={() => onConfig({ chart: { ...chart, type } })} className={`rounded-[6px] border px-2 py-1 text-[11.5px] ${chart.type === type ? "border-fg-ink" : "border-stroke-3 text-fg-3"}`}>
                    {{ bar: "Barras", hbar: "Barras horiz.", line: "Linha", area: "Área", pie: "Pizza", donut: "Rosca", sankey: "Fluxo" }[type]}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Valor">
              <SelectInput value={chart.metric} onChange={(v) => onConfig({ chart: { ...chart, metric: v as "sum" } })} options={[{ value: "sum", label: "Soma" }, { value: "count", label: "Quantidade" }, { value: "avg", label: "Média" }]} />
            </Field>
            <Check checked={chart.cumulative} onChange={(v) => onConfig({ chart: { ...chart, cumulative: v } })} label="Acumulado" />
          </>
        ) : null}
        {config.layout === "table" || config.layout === "board" ? (
          <>
            <Field label="Ordenar">
              <SelectInput value={sortKey(config.sort)} onChange={(v) => onConfig({ sort: SORTS.find((s) => s.v === v)!.sort })} options={SORTS.map((s) => ({ value: s.v, label: s.l }))} />
            </Field>
            <Field label="Propriedades visíveis">
              <div className="flex flex-wrap gap-1">
                {COLUMN_ORDER.map((col) => {
                  const on = config.columns.includes(col);
                  return (
                    <button
                      key={col}
                      type="button"
                      onClick={() => onConfig({ columns: on ? config.columns.filter((c) => c !== col) : COLUMN_ORDER.filter((c) => c === col || config.columns.includes(c)) })}
                      className={`rounded-[5px] border px-1.5 py-0.5 text-[11.5px] ${on ? "border-fg-3 bg-fill-3" : "border-stroke-3 text-fg-3"}`}
                    >
                      {COLUMN_LABEL[col]}
                    </button>
                  );
                })}
              </div>
            </Field>
          </>
        ) : null}
        <Field label="Transferências">
          <SelectInput value={config.transferDisplay} onChange={(v) => onConfig({ transferDisplay: v as "group" })} options={[{ value: "group", label: "Uma linha (origem → destino)" }, { value: "legs", label: "Duas linhas (saída + entrada)" }]} />
        </Field>
        <Check checked={isFavorite} onChange={onFavorite} label="Favorita (aparece na sidebar)" />
        <div className="flex flex-wrap gap-1.5 border-t border-stroke-3 pt-2">
          <Btn onClick={onDuplicate}>Duplicar</Btn>
          <Btn onClick={onExport}>Exportar CSV</Btn>
          {!isBuiltin ? <Btn danger onClick={onDelete}>Excluir view</Btn> : null}
          <Btn ghost onClick={onClose}>Fechar</Btn>
        </div>
      </div>
    </Popover>
  );
}
