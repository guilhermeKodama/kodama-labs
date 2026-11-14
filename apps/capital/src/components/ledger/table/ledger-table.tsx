"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MouseEvent } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useTranslations } from "next-intl";
import type { LedgerGroup, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { Badge, Check } from "@/components/cap";
import type { Names } from "@/lib/api/catalog";
import { useFmt } from "@/lib/format/provider";
import { aggKey, calcAggregation, calcOf, compactColumns, gridTemplate, nextCalc, PROP_META, SORTS, sortIdOf, SUM_KEY, visibleColumns, type CalcFn, type PropId } from "@/lib/ledger/columns";
import { nextEditableCell, type CellNavDirection } from "@/lib/ledger/cell-nav";
import { allVisibleSelected, applySelectionClick, moveFocus } from "@/lib/ledger/selection";
import { tableItems, visualRowIds, type GroupItem } from "@/lib/ledger/table-items";
import { useShortcut } from "@/lib/shortcuts";
import { useTextScale } from "@/lib/theme/use-text-scale";
import { cn } from "@/lib/utils";
import type { LedgerLabels } from "../fields";
import { EditableCell, type EditableField } from "../inline-edit";
import { RowActionsMenu, useRowActions } from "../row-actions";
import type { DisplayRow } from "../rows";

/** Row height at Médio; the rows are --cap-row-h (theme.css), this times the text scale. */
const ROW_H = 34;
/** Two-line row at Médio (description, then date · category · account). Matches the compact row's height. */
const COMPACT_ROW_H = 56;
const GROUP_H = 32;
/** Phones and a narrow window: the column grid collapses, so each transaction is two lines. */
const NARROW_LEDGER_QUERY = "(max-width: 640px)";

function subscribeNarrow(onChange: () => void) {
  const query = window.matchMedia(NARROW_LEDGER_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/**
 * True at 640px and below. The server snapshot is the wide table, same as
 * useIsMobile: hydration matches, then the client reads the viewport.
 */
function useNarrowLedger(): boolean {
  return useSyncExternalStore(subscribeNarrow, () => window.matchMedia(NARROW_LEDGER_QUERY).matches, () => false);
}
const EDITABLE: Partial<Record<PropId, EditableField>> = {
  date: "date",
  description: "description",
  entityId: "entityId",
  accountId: "accountId",
  categoryId: "categoryId",
  amountBase: "amount",
};

/** A transfer's account, category and entity are edited on the transfer, not in a cell. */
const readOnlyCell = (row: DisplayRow, field: EditableField) => row.neutral && (field === "accountId" || field === "categoryId" || field === "entityId");

/** The nearest scrolling ancestor (the page body), which the virtualizer follows. */
function scrollParent(node: HTMLElement): HTMLElement | null {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const overflow = getComputedStyle(el).overflowY;
    if (overflow === "auto" || overflow === "scroll") return el;
  }
  return null;
}

export interface LedgerTableProps {
  rows: readonly DisplayRow[];
  groups: readonly LedgerGroup[];
  config: ViewConfig;
  /** totals.values of the query (footer calcs). */
  totals: Record<string, number | null>;
  /** Display rows in the view (the select-all banner). */
  totalCount: number;
  names: Names;
  labels: LedgerLabels;
  /** "set/2026" for the empty message. */
  periodLabel: string;
  loading: boolean;
  hasMore: boolean;
  onLoadMore: () => void;
  selected: ReadonlySet<string>;
  onSelected: (next: Set<string>) => void;
  allInView: boolean;
  onAllInView: (on: boolean) => void;
  onConfig: (patch: Partial<ViewConfig>) => void;
  /**
   * Two-line rows. The screen leaves this unset and the table follows the
   * viewport (640px and below); tests pass it because a static render has no window.
   */
  narrow?: boolean;
}

/**
 * The transactions table (mockup tableLayout 2553–2753): columns from
 * "Propriedades visíveis", Data/Valor headers that sort, two levels of
 * collapsible groups with the server's counts and Σ, the select-all
 * banner, and the footer calcs (click to cycle). Rows are virtualized
 * against the page's scroll and page in as the end comes near.
 * Keyboard: ↑/↓ move, ↵ opens, X selects, ⌘A selects the visible rows,
 * Esc clears the selection, ⌫ and ⌘D act on the focused row.
 */
export function LedgerTable(props: LedgerTableProps) {
  const { rows, groups, config, totals, totalCount, names, labels, periodLabel, loading, hasMore, onLoadMore, selected, onSelected, allInView, onAllInView, onConfig, narrow } = props;
  const t = useTranslations("ledger.table");
  const fmt = useFmt();
  const actions = useRowActions();
  const columns = visibleColumns(config);
  const template = gridTemplate(columns);
  const detectedNarrow = useNarrowLedger();
  const compact = narrow ?? detectedNarrow;
  const compactLayout = compactColumns(columns);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [focused, setFocused] = useState<string | null>(null);
  const last = useRef<string | null>(null);

  const items = useMemo(() => tableItems(rows, groups, config.groupBy, collapsed), [rows, groups, config.groupBy, collapsed]);
  const visual = useMemo(() => visualRowIds(items), [items]);
  const visibleIds = useMemo(() => rows.map((row) => row.id), [rows]);
  const everyVisible = allVisibleSelected(selected, visibleIds);
  const byId = useMemo(() => new Map(rows.map((row) => [row.id, row])), [rows]);

  // Virtualization against the page body's scroll; the list's offset in it is the scroll margin.
  const [scrollEl, setScrollEl] = useState<HTMLElement | null>(null);
  const [listEl, setListEl] = useState<HTMLDivElement | null>(null);
  const [margin, setMargin] = useState(0);
  const rootRef = useCallback((node: HTMLDivElement | null) => setScrollEl(node ? scrollParent(node) : null), []);
  useEffect(() => {
    if (!scrollEl || !listEl) return;
    const measure = () => setMargin(listEl.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop);
    const observer = new ResizeObserver(measure);
    observer.observe(scrollEl);
    for (const child of Array.from(scrollEl.children)) observer.observe(child);
    return () => observer.disconnect();
  }, [scrollEl, listEl]);
  const textScale = useTextScale();
  const rowH = (compact ? COMPACT_ROW_H : ROW_H) * textScale;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollEl,
    estimateSize: (index) => (items[index]?.type === "group" ? GROUP_H : rowH),
    getItemKey: (index) => items[index]?.id ?? index,
    overscan: 12,
    scrollMargin: margin,
  });
  // Tamanho da letra changed: drop the cached sizes so rows are laid out at the new height.
  useEffect(() => virtualizer.measure(), [virtualizer, rowH]);
  const virtualItems = virtualizer.getVirtualItems();
  const lastIndex = virtualItems.length ? virtualItems[virtualItems.length - 1].index : -1;
  useEffect(() => {
    if (hasMore && !loading && lastIndex >= items.length - 15) onLoadMore();
  }, [hasMore, loading, lastIndex, items.length, onLoadMore]);

  const click = (id: string, on: boolean, shift: boolean) => {
    onAllInView(false);
    onSelected(applySelectionClick(selected, visual, last.current, { id, on, shift }));
    last.current = id;
  };
  const focusRow = (id: string | null) => {
    setFocused(id);
    if (!id) return;
    const index = items.findIndex((item) => item.id === id);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  };

  const hasRows = rows.length > 0;
  useShortcut(["arrowdown", "arrowup"], (event) => {
    if (!hasRows) return false;
    focusRow(moveFocus(visual, focused, event.key === "ArrowUp" ? -1 : 1));
  });
  useShortcut("enter", () => {
    const row = focused ? byId.get(focused) : null;
    if (!row) return false;
    actions.open(row);
  });
  useShortcut("x", () => {
    if (!focused) return false;
    click(focused, !selected.has(focused), false);
  });
  useShortcut("mod+a", () => {
    if (!hasRows) return false;
    onAllInView(false);
    onSelected(new Set(visibleIds));
  });
  useShortcut("escape", () => {
    if (!selected.size && !allInView) return false;
    onAllInView(false);
    onSelected(new Set());
  });
  useShortcut(["backspace", "delete"], () => {
    const row = focused && !selected.size ? byId.get(focused) : null;
    if (!row) return false;
    actions.remove(row);
  });
  useShortcut("mod+d", () => {
    const row = focused && !selected.size ? byId.get(focused) : null;
    if (!row) return false;
    actions.duplicate(row);
  });

  // Tab / ⇧Tab / ↵ after an inline commit: open the editor of the next cell (scrolled into view first).
  const editableColumns = columns.filter((id) => EDITABLE[id]);
  const navigateCell = (row: DisplayRow, column: PropId, direction: CellNavDirection) => {
    const target = nextEditableCell(visual, editableColumns, { rowId: row.id, column }, direction, (rowId, id) => {
      const other = byId.get(rowId);
      const field = EDITABLE[id as PropId];
      return !!other && !!field && !readOnlyCell(other, field);
    });
    if (!target) return;
    focusRow(target.rowId);
    const open = () => {
      const wrapper = Array.from(listEl?.querySelectorAll<HTMLElement>("[data-cell-row]") ?? []).find(
        (el) => el.dataset.cellRow === target.rowId && el.dataset.cellColumn === target.column
      );
      (wrapper?.firstElementChild as HTMLElement | null)?.click();
    };
    // The row may only be drawn after the scroll: wait two frames.
    requestAnimationFrame(() => requestAnimationFrame(open));
  };

  const toggleGroup = (id: string) =>
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const amount = (row: DisplayRow) => (
    <span className="flex min-w-0 items-baseline justify-end gap-1.5">
      {row.currency !== names.currency ? <span className="truncate font-mono text-hint text-fg-4 tabular-nums">{fmt.money(Math.abs(row.amount), row.currency)}</span> : null}
      <span className={cn("font-mono text-body whitespace-nowrap tabular-nums", row.neutral ? "text-fg-3" : row.displayAmount > 0 ? "text-pos" : "text-fg-1")}>
        {row.neutral ? `⇄ ${fmt.number(Math.abs(row.displayAmount))}` : fmt.money(row.displayAmount)}
      </span>
    </span>
  );

  const cellContent = (row: DisplayRow, id: PropId) => {
    switch (id) {
      case "date":
        return <span className="font-mono text-label text-fg-3 tabular-nums">{fmt.date(row.date)}</span>;
      case "description":
        return (
          <button type="button" className={cn("flex min-w-0 items-center gap-1.5 text-left", compact && "w-full")} onClick={() => actions.open(row)}>
            <span className={cn("min-w-0 truncate", compact && "font-semibold")}>{row.description}</span>
            {row.installmentNumber && row.installmentTotal ? (
              <span className="shrink-0 font-mono text-caption text-fg-4">{t("installment", { n: row.installmentNumber, total: row.installmentTotal })}</span>
            ) : null}
            {row.isRecurring ? (
              <span className="shrink-0 text-caption text-fg-4" title={t("recurring")}>
                ↻
              </span>
            ) : null}
            {row.isTaxDeductible ? <Badge className="shrink-0">{t("taxBadge")}</Badge> : null}
          </button>
        );
      case "entityId":
        return <Badge>{labels.rowEntity(row)}</Badge>;
      case "amountBase":
        return amount(row);
      default:
        return <span className="truncate text-fg-2">{labels.cell(id, row, config.dateField)}</span>;
    }
  };

  const cell = (row: DisplayRow, id: PropId) => {
    const content = cellContent(row, id);
    const field = EDITABLE[id];
    return (
      <span key={id} className="flex min-w-0 items-center overflow-hidden" data-cell-row={field ? row.id : undefined} data-cell-column={field ? id : undefined}>
        {field ? (
          <EditableCell row={row} field={field} names={names} disabled={readOnlyCell(row, field)} onNavigate={(direction) => navigateCell(row, id, direction)}>
            {content}
          </EditableCell>
        ) : (
          content
        )}
      </span>
    );
  };

  const selectRow = (row: DisplayRow) => (
    <Check
      checked={allInView || selected.has(row.id)}
      aria-label={t("selectRow")}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault();
        click(row.id, !selected.has(row.id), event.shiftKey);
      }}
      onChange={() => undefined}
    />
  );

  const rowEl = (row: DisplayRow) => {
    const isSel = allInView || selected.has(row.id);
    const tone = isSel ? "bg-fill-3" : focused === row.id && "bg-fill-4";
    if (compact) {
      const meta = compactLayout.meta.map((id) => labels.cell(id, row, config.dateField));
      return (
        <div
          data-ledger-row=""
          className={cn(
            "grid h-[calc(56px*var(--cap-text-scale))] grid-cols-[28px_minmax(0,1fr)_auto_28px] items-center gap-x-2 gap-y-0.5 overflow-hidden border-t border-stroke-3 px-2.5 text-body",
            meta.length ? "grid-rows-2" : "grid-rows-1",
            tone,
          )}
          onMouseDown={() => setFocused(row.id)}
        >
          <span className="col-start-1 row-span-2 flex justify-center">{selectRow(row)}</span>
          <div className="col-start-2 row-start-1 flex min-w-0 items-center overflow-hidden">{compactLayout.title ? cellContent(row, compactLayout.title) : null}</div>
          <span className="col-start-3 row-span-2 flex items-center justify-end">{compactLayout.showAmount ? amount(row) : null}</span>
          <span className="col-start-4 row-span-2 flex items-center justify-center">
            <RowActionsMenu row={row} />
          </span>
          {meta.length ? (
            <div data-ledger-meta="" className="col-start-2 row-start-2 truncate text-label font-normal text-fg-3">
              {meta.join(" · ")}
            </div>
          ) : null}
        </div>
      );
    }
    return (
      <div
        data-ledger-row=""
        className={cn("relative grid h-(--cap-row-h) items-center gap-2 border-t border-stroke-3 px-2.5 text-body", tone)}
        style={{ gridTemplateColumns: template }}
        onMouseDown={() => setFocused(row.id)}
      >
        {selectRow(row)}
        {columns.map((id) => cell(row, id))}
        <span className="flex justify-center">
          <RowActionsMenu row={row} />
        </span>
      </div>
    );
  };

  const groupEl = (item: GroupItem) => {
    const sum = item.group?.values[SUM_KEY] ?? null;
    return (
      <button
        type="button"
        onClick={() => toggleGroup(item.id)}
        className={cn("flex h-8 w-full items-center gap-2 border-t border-stroke-3 pr-2.5 text-left text-body-sm", item.level === 0 ? "bg-fill-3" : "bg-fill-4")}
        style={{ paddingLeft: 16 + item.level * 18 }}
      >
        <span className="w-2.5 text-fg-3">{item.collapsed ? "▸" : "▾"}</span>
        <span className={cn("truncate", item.level === 0 ? "font-semibold" : "font-medium")}>{labels.groupValue(item.groupKey, item.value)}</span>
        <span className="text-fg-3">{item.group?.count ?? ""}</span>
        <span className={cn("ml-auto font-mono tabular-nums", item.level === 0 ? "font-semibold" : "font-medium")}>{sum === null ? "" : fmt.money(sum)}</span>
      </button>
    );
  };

  const sortId = sortIdOf(config.sort);
  const header = (id: PropId) => {
    const sortable = id === "date" || id === "amountBase";
    const arrow = id === "date" && (sortId === "date_desc" || sortId === "date_asc") ? (sortId === "date_desc" ? " ↓" : " ↑") : id === "amountBase" && sortId === "abs_desc" ? " ↓" : "";
    const onClick = id === "date" ? () => onConfig({ sort: SORTS[sortId === "date_desc" ? "date_asc" : "date_desc"] }) : id === "amountBase" ? () => onConfig({ sort: SORTS.abs_desc }) : undefined;
    const content = (
      <>
        {labels.prop(id)}
        {arrow}
      </>
    );
    return sortable ? (
      <button key={id} type="button" onClick={onClick} className={cn("flex items-center gap-1.5 whitespace-nowrap hover:text-fg-strong", id === "amountBase" && "justify-end")}>
        {content}
      </button>
    ) : (
      <span key={id} className="truncate">
        {content}
      </span>
    );
  };

  const calcText = (id: PropId, calc: CalcFn) => {
    const agg = calcAggregation(id, calc, config.dateField);
    const value = agg ? (totals[aggKey(agg)] ?? null) : null;
    if (value === null) return "—";
    return calc === "count" || calc === "countDistinct" ? fmt.number(value, 0) : fmt.money(value);
  };

  const selectVisible = (
    <Check
      checked={hasRows && everyVisible}
      aria-label={t("selectVisible")}
      onChange={(on) => {
        onAllInView(false);
        onSelected(on ? new Set(visibleIds) : new Set());
      }}
    />
  );

  const footerCell = (id: PropId, labeled: boolean) => {
    const calc = calcOf(config, id);
    return (
      <button
        key={id}
        type="button"
        onClick={() => onConfig({ calcs: { ...config.calcs, [id]: nextCalc(id, calc) } })}
        className={cn("flex items-baseline gap-1.5", labeled ? "max-w-full" : "min-w-0 overflow-hidden", !labeled && (PROP_META[id].label === "amount" ? "justify-end" : "justify-start"))}
      >
        {labeled ? <span className="text-micro tracking-[0.4px] text-fg-4 uppercase">{labels.prop(id)}</span> : null}
        <span className={cn("text-micro tracking-[0.4px] uppercase", !labeled && "whitespace-nowrap", calc === "none" ? "text-fg-4" : "text-fg-3")}>{t(`calc.${calc}`)}</span>
        {calc !== "none" ? <span className={cn("font-mono text-body-sm font-semibold tabular-nums", !labeled && "truncate")}>{calcText(id, calc)}</span> : null}
      </button>
    );
  };

  return (
    <div ref={rootRef} data-ledger-layout={compact ? "compact" : "grid"} className="rounded-[8px] border border-stroke-3 bg-panel">
      {compact ? (
        <div data-ledger-header="" className="grid h-(--cap-row-h) grid-cols-[28px_minmax(0,1fr)_auto_28px] items-center gap-2 px-2.5 text-label text-fg-3">
          {selectVisible}
          {columns.includes("date") ? header("date") : <span />}
          {columns.includes("amountBase") ? header("amountBase") : <span />}
          <span />
        </div>
      ) : (
        <div data-ledger-header="" className="grid h-(--cap-row-h) items-center gap-2 px-2.5 text-label text-fg-3" style={{ gridTemplateColumns: template }}>
          {selectVisible}
          {columns.map(header)}
          <span />
        </div>
      )}
      {hasRows && everyVisible ? (
        <div className="flex flex-wrap justify-center gap-1.5 border-t border-stroke-3 bg-fill-4 px-3 py-[7px] text-body-sm">
          {allInView ? (
            <>
              <span>{t("allSelected", { count: totalCount })}</span>
              <button
                type="button"
                className="underline"
                onClick={() => {
                  onAllInView(false);
                  onSelected(new Set());
                }}
              >
                {t("clearSelection")}
              </button>
            </>
          ) : (
            <>
              <span className="text-fg-2">{t("visibleSelected", { count: rows.length })}</span>
              <button type="button" className="font-medium underline" onClick={() => onAllInView(true)}>
                {t("selectAll", { count: totalCount })}
              </button>
            </>
          )}
        </div>
      ) : null}
      {!hasRows ? (
        <div className="border-t border-stroke-3 px-3 py-[18px] text-center text-body text-fg-3">{loading ? t("loading") : t("empty", { period: periodLabel })}</div>
      ) : null}
      <div ref={setListEl} className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualItems.map((virtual) => {
          const item = items[virtual.index];
          if (!item) return null;
          return (
            <div key={virtual.key} className="absolute top-0 left-0 w-full" style={{ transform: `translateY(${virtual.start - margin}px)` }}>
              {item.type === "group" ? groupEl(item) : rowEl(item.row)}
            </div>
          );
        })}
      </div>
      {hasRows && hasMore ? <div className="border-t border-stroke-3 px-3 py-2 text-center text-body-sm text-fg-3">{t("loading")}</div> : null}
      {compact ? (
        <div data-ledger-footer="" className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 rounded-b-[8px] border-t border-stroke-2 bg-fill-4 px-2.5 py-2">
          {columns.map((id) => footerCell(id, true))}
        </div>
      ) : (
        <div data-ledger-footer="" className="grid h-(--cap-row-h) items-center gap-2 rounded-b-[8px] border-t border-stroke-2 bg-fill-4 px-2.5" style={{ gridTemplateColumns: template }}>
          <span />
          {columns.map((id) => footerCell(id, false))}
          <span />
        </div>
      )}
      {actions.dialogs}
    </div>
  );
}
