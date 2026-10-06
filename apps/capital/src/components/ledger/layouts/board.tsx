"use client";

import { useTranslations } from "next-intl";
import type { GroupKey, LedgerGroup, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { Badge, Btn, EmptyRow } from "@/components/cap";
import { useFmt } from "@/lib/format/provider";
import { groupIdOf, SUM_KEY, visibleColumns } from "@/lib/ledger/columns";
import { cn } from "@/lib/utils";
import type { LedgerLabels } from "../fields";
import type { DisplayRow } from "../rows";

/**
 * Board (mockup 2960–2992): a column per group value (Colunas, default
 * Categoria) with its count and Σ, cards with the description, amount,
 * date and a badge per visible property. Rows come from the server in
 * column order with their group key; a card opens the detail.
 */
export function BoardView({
  rows,
  groups,
  groupKey,
  config,
  labels,
  totalCount,
  hasMore,
  loading,
  onMore,
  onOpen,
}: {
  rows: readonly DisplayRow[];
  groups: readonly LedgerGroup[];
  groupKey: GroupKey;
  config: ViewConfig;
  labels: LedgerLabels;
  totalCount: number;
  hasMore: boolean;
  loading: boolean;
  onMore: () => void;
  onOpen: (row: DisplayRow) => void;
}) {
  const t = useTranslations("ledger");
  const fmt = useFmt();
  const groupProp = groupIdOf(groupKey);
  const badges = visibleColumns(config).filter((id) => id !== groupProp && id !== "description" && id !== "amountBase" && id !== "date");
  if (!groups.length) {
    return (
      <div className="rounded-[8px] border border-stroke-3">
        <EmptyRow>{loading ? t("table.loading") : t("charts.empty")}</EmptyRow>
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2.5 overflow-x-auto pb-1">
        {groups.map((group) => {
          const cards = rows.filter((row) => (row.groupKeys?.[0] ?? null) === group.key);
          return (
            <section key={String(group.key)} className="flex w-[230px] shrink-0 flex-col gap-1.5 rounded-[8px] bg-fill-4 p-2">
              <header className="flex items-center gap-1.5 px-0.5 pt-0.5 pb-1 text-[12px]">
                <span className="truncate font-semibold">{labels.groupValue(groupKey, group.key)}</span>
                <span className="text-fg-3">{group.count}</span>
                <span className="ml-auto font-mono text-[11.5px] tabular-nums">{fmt.money0(group.values[SUM_KEY] ?? 0)}</span>
              </header>
              {cards.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  onClick={() => onOpen(row)}
                  className="flex flex-col gap-1.5 rounded-[7px] border border-stroke-3 bg-editor p-2 text-left hover:border-stroke-1"
                >
                  <span className="flex min-w-0 items-baseline gap-1.5">
                    <span className="truncate text-[12.5px]">{row.description}</span>
                    <span className={cn("ml-auto shrink-0 font-mono text-[12px] tabular-nums", row.displayAmount > 0 && !row.neutral ? "text-pos" : "text-fg-1")}>
                      {row.neutral ? "⇄" : fmt.money0(row.displayAmount)}
                    </span>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    <span className="font-mono text-[10.5px] text-fg-3 tabular-nums">{fmt.date(row.date)}</span>
                    {badges.map((id) => (
                      <Badge key={id}>{labels.cell(id, row)}</Badge>
                    ))}
                  </span>
                </button>
              ))}
            </section>
          );
        })}
      </div>
      {hasMore ? (
        <div className="flex items-center gap-2 text-[12px] text-fg-3">
          <Btn onClick={onMore} disabled={loading}>
            {t("board.more")}
          </Btn>
          <span>{t("board.shown", { shown: rows.length, total: totalCount })}</span>
        </div>
      ) : null}
    </div>
  );
}
