"use client";

import { Fragment, useRef, useState } from "react";
import type { LedgerGroup, ViewConfig } from "@capital/server/modules/ledger/contracts";
import type { Names } from "@/lib/catalog";
import { dayLabel, money } from "@/lib/money";
import { cn } from "@/lib/utils";
import { Badge, EmptyRow } from "@/components/shell/chrome";
import { COLUMN_LABEL, KIND_LABEL, groupValueLabel, rowGroupKey } from "./fields";
import type { DisplayRow } from "./rows";

const WIDTH: Record<string, string> = {
  date: "52px",
  description: "minmax(0,2.2fr)",
  entityId: "minmax(0,1fr)",
  accountId: "minmax(0,1.2fr)",
  categoryId: "minmax(0,1.1fr)",
  kind: "96px",
  isTaxDeductible: "40px",
  amountBase: "150px",
};

export function LedgerTable({
  rows,
  groups,
  config,
  names,
  selected,
  onSelect,
  onOpen,
  onCategory,
  totals,
  hasMore,
  onMore,
  loading,
}: {
  rows: DisplayRow[];
  groups: LedgerGroup[];
  config: ViewConfig;
  names: Names;
  selected: Set<string>;
  onSelect: (ids: string[], on: boolean) => void;
  onOpen: (row: DisplayRow) => void;
  onCategory: (row: DisplayRow, categoryId: string | null) => void;
  totals: { count: number; sum: number };
  hasMore: boolean;
  onMore: () => void;
  loading: boolean;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const last = useRef<string | null>(null);
  const columns = config.columns.filter((c) => c in WIDTH);
  if (!columns.includes("amountBase")) columns.push("amountBase");
  const template = `28px ${columns.map((c) => WIDTH[c]).join(" ")}`;
  const key1 = config.groupBy[0];
  const key2 = config.groupBy[1];
  const allOn = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const currency = names.currency;

  function toggle(row: DisplayRow, on: boolean, shift: boolean) {
    if (shift && last.current) {
      const a = rows.findIndex((r) => r.id === last.current);
      const b = rows.findIndex((r) => r.id === row.id);
      if (a >= 0 && b >= 0) {
        onSelect(rows.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id), on);
        last.current = row.id;
        return;
      }
    }
    onSelect([row.id], on);
    last.current = row.id;
  }

  const cell = (row: DisplayRow, col: string) => {
    switch (col) {
      case "date":
        return <span className="font-mono text-[11.5px] text-fg-3">{dayLabel(row.date)}</span>;
      case "description":
        return (
          <button type="button" className="flex min-w-0 items-center gap-1.5 text-left hover:underline" onClick={() => onOpen(row)}>
            <span className="truncate">{row.description}</span>
            {row.isRecurring ? <span className="text-[11px] text-fg-3" title="Recorrente">↻</span> : null}
            {row.installmentNumber ? <span className="text-[11px] text-fg-3">parc. {row.installmentNumber}</span> : null}
            {row.isTaxDeductible ? <Badge>IR</Badge> : null}
          </button>
        );
      case "entityId":
        return <span className="min-w-0"><Badge>{names.entity.get(row.entityId) ?? "—"}</Badge></span>;
      case "accountId":
        return (
          <span className="truncate text-fg-2">
            {names.account.get(row.accountId)}
            {row.toAccountId ? ` → ${names.account.get(row.toAccountId) ?? ""}` : ""}
          </span>
        );
      case "categoryId":
        if (row.neutral || row.kind === "transfer") return <span className="text-fg-3">Transferência</span>;
        return (
          <select
            value={row.categoryId ?? ""}
            onChange={(event) => onCategory(row, event.target.value || null)}
            className={cn("min-w-0 truncate bg-transparent outline-none hover:underline", !row.categoryId && "text-warn")}
          >
            <option value="">Sem categoria</option>
            {names.categories
              .filter((c) => !c.isArchived || c.id === row.categoryId)
              .filter((c) => (row.kind === "income" ? c.type === "income" : c.type !== "income") || c.id === row.categoryId)
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
          </select>
        );
      case "kind":
        return <span className="text-fg-2">{row.neutral ? "Transferência" : KIND_LABEL[row.kind]}</span>;
      case "isTaxDeductible":
        return <span className="text-fg-muted">{row.isTaxDeductible ? "Sim" : ""}</span>;
      case "amountBase":
        return (
          <span className="flex items-baseline justify-end gap-1.5">
            {row.currency !== currency ? <span className="font-mono text-[10.5px] text-fg-3">{money(row.amount, row.currency)}</span> : null}
            <span className={cn("font-mono tabular-nums", row.neutral ? "text-fg-3" : row.amountBase > 0 ? "text-pos" : "")}>
              {row.neutral ? `⇄ ${money(row.amountBase, currency).replace("−", "")}` : money(row.amountBase, currency)}
            </span>
          </span>
        );
    }
    return null;
  };

  const rowEl = (row: DisplayRow) => (
    <div
      key={row.id}
      className={cn("grid h-[34px] items-center gap-2 border-t border-stroke-3 px-2.5 text-[12.5px]", selected.has(row.id) && "bg-fill-3")}
      style={{ gridTemplateColumns: template }}
    >
      <input
        type="checkbox"
        className="size-3.5 accent-fg-ink"
        checked={selected.has(row.id)}
        onClick={(event) => toggle(row, (event.target as HTMLInputElement).checked, event.shiftKey)}
        onChange={() => undefined}
      />
      {columns.map((col) => (
        <span key={col} className="flex min-w-0">{cell(row, col)}</span>
      ))}
    </div>
  );

  const groupHeader = (id: string, label: string, count: number, sum: number | null | undefined, depth: number, ids: string[]) => {
    const isCollapsed = collapsed.has(id);
    const allGroupOn = ids.length > 0 && ids.every((rid) => selected.has(rid));
    return (
      <div
        className={cn("flex h-8 items-center gap-2 border-t border-stroke-3 px-2.5 text-[12px]", depth === 0 ? "bg-fill-4" : "bg-editor")}
        style={{ paddingLeft: depth ? 34 : undefined }}
      >
        <input type="checkbox" className="size-3.5 accent-fg-ink" checked={allGroupOn} onChange={(event) => onSelect(ids, event.target.checked)} />
        <button
          type="button"
          className="flex items-center gap-2"
          onClick={() => setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
          })}
        >
          <span className="text-fg-3">{isCollapsed ? "▸" : "▾"}</span>
          <span className="font-semibold">{label}</span>
          <span className="text-fg-3">{count}</span>
        </button>
        <span className="ml-auto font-mono font-semibold tabular-nums">{sum == null ? "" : money(sum, currency)}</span>
      </div>
    );
  };

  const body = () => {
    if (!rows.length) return <EmptyRow>{loading ? "Carregando…" : "Nenhum lançamento neste recorte."}</EmptyRow>;
    if (!key1) return rows.map(rowEl);
    const order = groups.map((g) => g.key);
    const buckets = new Map<string | null, DisplayRow[]>();
    for (const row of rows) {
      const k = rowGroupKey(row, key1);
      buckets.set(k, [...(buckets.get(k) ?? []), row]);
    }
    const keys = [...order.filter((k) => buckets.has(k)), ...[...buckets.keys()].filter((k) => !order.includes(k))];
    return keys.map((k) => {
      const items = buckets.get(k) ?? [];
      const group = groups.find((g) => g.key === k);
      const id = `g:${k}`;
      return (
        <Fragment key={id}>
          {groupHeader(id, groupValueLabel(key1, k, names), group?.count ?? items.length, group?.values["sum:amountBase"], 0, items.map((r) => r.id))}
          {collapsed.has(id)
            ? null
            : key2
              ? (() => {
                  const sub = new Map<string | null, DisplayRow[]>();
                  for (const row of items) {
                    const sk = rowGroupKey(row, key2);
                    sub.set(sk, [...(sub.get(sk) ?? []), row]);
                  }
                  return [...sub.entries()].map(([sk, subRows]) => {
                    const subId = `${id}:${sk}`;
                    const subGroup = group?.children?.find((c) => c.key === sk);
                    return (
                      <Fragment key={subId}>
                        {groupHeader(subId, groupValueLabel(key2, sk, names), subGroup?.count ?? subRows.length, subGroup?.values["sum:amountBase"] ?? subRows.reduce((s, r) => s + (r.neutral ? 0 : r.amountBase), 0), 1, subRows.map((r) => r.id))}
                        {collapsed.has(subId) ? null : subRows.map(rowEl)}
                      </Fragment>
                    );
                  });
                })()
              : items.map(rowEl)}
        </Fragment>
      );
    });
  };

  return (
    <div className="overflow-hidden rounded-lg border border-stroke-3">
      <div className="grid h-[34px] items-center gap-2 px-2.5 text-[11.5px] text-fg-3" style={{ gridTemplateColumns: template }}>
        <input type="checkbox" className="size-3.5 accent-fg-ink" checked={allOn} onChange={(event) => onSelect(rows.map((r) => r.id), event.target.checked)} />
        {columns.map((col) => (
          <span key={col} className={col === "amountBase" ? "text-right" : ""}>{COLUMN_LABEL[col]}</span>
        ))}
      </div>
      {body()}
      {hasMore ? (
        <button type="button" onClick={onMore} className="block h-8 w-full border-t border-stroke-3 text-[12px] text-fg-muted hover:bg-fill-4">
          Carregar mais
        </button>
      ) : null}
      <div className="flex h-[34px] items-center gap-2 border-t border-stroke-1 bg-fill-4 px-2.5 text-[12px]">
        <span className="font-medium">{totals.count} lançamentos</span>
        <span className="text-fg-3">{rows.length < totals.count ? `· ${rows.length} carregados` : ""}</span>
        <span className="ml-auto text-fg-3">Soma</span>
        <span className={cn("w-[150px] text-right font-mono font-semibold tabular-nums", totals.sum > 0 && "text-pos")}>{money(totals.sum, currency)}</span>
      </div>
    </div>
  );
}
