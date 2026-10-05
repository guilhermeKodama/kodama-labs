"use client";

import { useMemo } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { LedgerQueryResult } from "@capital/server/modules/ledger/contracts";
import { Btn, DialogHead, Sheet } from "@/components/cap";
import { apiGet, apiPost } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useAppMutation } from "@/lib/api/use-app-mutation";
import { useFmt } from "@/lib/format/provider";
import { trashRows, type TrashRow } from "@/lib/ledger/trash";
import { cn } from "@/lib/utils";

export interface TrashSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  names: Names;
}

/** GET /v2/trash: the deleted legs, newest first, plus `rowsCount` (rows as the table counts them). */
export type TrashPage = LedgerQueryResult & { rowsCount?: number };

const PAGE = 100;

/**
 * "Lixeira", opened by ?trash=1 from the "Lixeira · N" header button
 * (mockup DeleteFlow 5413): a 440px sheet listing what was deleted, a
 * transfer as one row, with "Restaurar" (POST /v2/trash/restore, undoable).
 * Rows leave the trash for good after 30 days.
 */
export function TrashSheet({ open, onOpenChange, names }: TrashSheetProps) {
  const t = useTranslations("entry.trash");
  return (
    <Sheet open={open} onOpenChange={onOpenChange} width={440}>
      <DialogHead title={t("title")} desc={t("desc")} />
      {open ? <TrashList names={names} /> : null}
    </Sheet>
  );
}

function TrashList({ names }: { names: Names }) {
  const t = useTranslations("entry");
  const fmt = useFmt();
  const pages = useInfiniteQuery({
    queryKey: keys.trash({ limit: PAGE }),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => apiGet<TrashPage>("/api/v2/trash", { limit: PAGE, cursor: pageParam }),
    getNextPageParam: (last) => (last.pageInfo.hasMore ? (last.pageInfo.nextCursor ?? undefined) : undefined),
  });
  const rows = useMemo(() => trashRows((pages.data?.pages ?? []).flatMap((page) => page.rows)), [pages.data]);
  const restore = useAppMutation({
    event: "ledger.write",
    mutationFn: (row: TrashRow) => apiPost<{ batchId: string | null }>("/api/v2/trash/restore", { ids: [row.id] }),
    undo: (_result, row) => t("toast.restored", { description: row.description }),
  });

  if (pages.isPending) return <p className="text-[12.5px] text-fg-3">{t("sheet.loading")}</p>;
  if (!rows.length) return <p className="text-[12.5px] text-fg-3">{t("trash.empty")}</p>;

  const where = (row: TrashRow) =>
    row.transfer && row.toAccountId
      ? t("trash.transfer", { from: names.account.get(row.accountId) ?? "", to: names.account.get(row.toAccountId) ?? "" })
      : (names.account.get(row.accountId) ?? "");

  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <div key={row.id} className="grid grid-cols-[52px_minmax(0,1fr)_auto_auto] items-center gap-2 border-t border-stroke-3 py-1.5 text-[12.5px] first:border-t-0">
          <span className="font-mono text-[11.5px] text-fg-3">{fmt.date(row.date)}</span>
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{row.description}</span>
            <span className="truncate text-[11px] text-fg-3">{where(row)}</span>
          </span>
          <span className={cn("font-mono tabular-nums", row.transfer ? "text-fg-3" : row.amount > 0 && "text-pos")}>
            {row.transfer ? `⇄ ${fmt.money(row.amount, names.currency).replace("−", "")}` : fmt.money(row.amount, names.currency)}
          </span>
          <Btn ghost disabled={restore.isPending} onClick={() => restore.mutate(row)}>
            {t("trash.restore")}
          </Btn>
        </div>
      ))}
      {pages.hasNextPage ? (
        <Btn ghost className="mt-2 self-center" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
          {t("trash.more")}
        </Btn>
      ) : null}
    </div>
  );
}
