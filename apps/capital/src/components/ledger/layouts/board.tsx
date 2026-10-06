"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { GroupKey, LedgerDisplayQueryResult, LedgerGroup, LedgerQueryInput, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { Badge, Btn, EmptyRow } from "@/components/cap";
import { apiPost } from "@/lib/api/client";
import { keys } from "@/lib/api/keys";
import { useErrorMessage } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { boardCards, boardColumnLimit, boardRemaining } from "@/lib/ledger/board";
import { groupIdOf, SUM_KEY, visibleColumns } from "@/lib/ledger/columns";
import { cn } from "@/lib/utils";
import type { LedgerLabels } from "../fields";
import type { DisplayRow } from "../rows";

/**
 * Board (mockup 2960–2992): a column per group value (Colunas, default
 * Categoria) with its count and Σ, cards with the description, amount,
 * date and a badge per visible property. The view's first page fills the
 * columns in order; a column with more rows than it shows loads the rest
 * on its own. A card opens the detail.
 */
export function BoardView({
  rows,
  groups,
  groupKey,
  config,
  labels,
  loading,
  columnQuery,
  onOpen,
}: {
  rows: readonly DisplayRow[];
  groups: readonly LedgerGroup[];
  groupKey: GroupKey;
  config: ViewConfig;
  labels: LedgerLabels;
  loading: boolean;
  /** The query of one column's own pages (its group value, a page size). */
  columnQuery: (value: string | null, limit: number) => LedgerQueryInput;
  onOpen: (row: DisplayRow) => void;
}) {
  const t = useTranslations("ledger");
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
    <div className="flex gap-2.5 overflow-x-auto pb-1">
      {groups.map((group) => (
        <BoardColumn key={String(group.key)} group={group} groupKey={groupKey} rows={rows} badges={badges} labels={labels} columnQuery={columnQuery} onOpen={onOpen} />
      ))}
    </div>
  );
}

function BoardColumn({
  group,
  groupKey,
  rows,
  badges,
  labels,
  columnQuery,
  onOpen,
}: {
  group: LedgerGroup;
  groupKey: GroupKey;
  rows: readonly DisplayRow[];
  badges: ReturnType<typeof visibleColumns>;
  labels: LedgerLabels;
  columnQuery: (value: string | null, limit: number) => LedgerQueryInput;
  onOpen: (row: DisplayRow) => void;
}) {
  const t = useTranslations("ledger.board");
  const fmt = useFmt();
  const errorText = useErrorMessage();
  const firstCards = boardCards(group.key, rows);
  // The page size is fixed when the column starts loading (so the query key stays put while it pages).
  const [limit, setLimit] = useState<number | null>(null);
  const body = limit === null ? null : columnQuery(group.key, limit);
  const pages = useInfiniteQuery({
    queryKey: keys.ledgerQuery({ ...body, paged: true, boardColumn: true }),
    enabled: body !== null,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiPost<LedgerDisplayQueryResult>("/api/v2/ledger/query", { ...body, page: { ...body?.page, cursor: pageParam } }),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
  });
  const columnRows = pages.data?.pages.flatMap((page) => page.rows) as DisplayRow[] | undefined;
  const cards = columnRows ? boardCards(group.key, rows, columnRows) : firstCards;
  const remaining = boardRemaining(group, cards.length);
  const canLoad = remaining > 0 && (limit === null || pages.isFetching || !!pages.hasNextPage);
  const loadMore = () => {
    if (limit === null) setLimit(boardColumnLimit(firstCards.length));
    else void pages.fetchNextPage();
  };

  return (
    <section className="flex w-[230px] shrink-0 flex-col gap-1.5 rounded-[8px] bg-fill-4 p-2">
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
      {canLoad ? (
        <div className="flex items-center gap-2 px-0.5 text-[11px] text-fg-3">
          <Btn ghost onClick={loadMore} disabled={pages.isFetching}>
            {pages.isFetching ? t("loading") : t("more")}
          </Btn>
          <span>{t("shown", { shown: cards.length, total: group.count })}</span>
        </div>
      ) : null}
      {pages.isError ? <span className="px-0.5 text-[11px] text-neg">{errorText(pages.error)}</span> : null}
    </section>
  );
}
