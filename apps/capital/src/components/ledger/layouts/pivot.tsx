"use client";

import { useTranslations } from "next-intl";
import type { GroupKey, LedgerQueryResult } from "@capital/server/modules/ledger/contracts";
import { EmptyRow, Table } from "@/components/cap";
import { useFmt } from "@/lib/format/provider";
import { groupIdOf } from "@/lib/ledger/columns";
import type { DrillCell } from "@/lib/ledger/drill";
import { cn } from "@/lib/utils";
import type { LedgerLabels } from "../fields";

/**
 * Pivot (mockup 2816–2861): Linhas × Colunas, Σ of the counted rows in
 * each cell, row and column totals. Every number opens the table with
 * that slice as a draft (the totals with one side, the grand total with
 * none).
 */
export function PivotView({
  pivot,
  rowsKey,
  colsKey,
  labels,
  onDrill,
}: {
  pivot: LedgerQueryResult["pivot"] | undefined;
  rowsKey: GroupKey;
  colsKey: GroupKey;
  labels: LedgerLabels;
  onDrill: (cells: DrillCell[]) => void;
}) {
  const t = useTranslations("ledger.pivot");
  const fmt = useFmt();
  const rowsName = labels.prop(groupIdOf(rowsKey));
  const colsName = labels.prop(groupIdOf(colsKey));

  const cell = (value: number | null, cells: DrillCell[], bold?: boolean) => {
    const v = value ?? 0;
    if (v === 0) return <span className="font-mono text-fg-4 tabular-nums">—</span>;
    return (
      <button
        type="button"
        onClick={() => onDrill(cells)}
        className={cn("font-mono tabular-nums underline decoration-dotted underline-offset-[3px]", bold && "font-semibold", v > 0 ? "text-pos" : "text-fg-1")}
      >
        {fmt.money0(v)}
      </button>
    );
  };

  const caption = <span className="text-[12px] text-fg-3">{t("caption", { rows: rowsName, cols: colsName })}</span>;
  if (!pivot || !pivot.rowKeys.length) {
    return (
      <div className="flex flex-col gap-2">
        {caption}
        <div className="rounded-[8px] border border-stroke-3">
          <EmptyRow>{t("empty")}</EmptyRow>
        </div>
      </div>
    );
  }
  const rowCell = (key: string | null): DrillCell => ({ key: rowsKey, value: key });
  const colCell = (key: string | null): DrillCell => ({ key: colsKey, value: key });
  return (
    <div className="flex flex-col gap-2">
      {caption}
      <Table
        headers={[t("corner", { rows: rowsName, cols: colsName }), ...pivot.colKeys.map((key) => labels.groupValue(colsKey, key)), t("total")]}
        columnAlign={["left", ...pivot.colKeys.map(() => "right" as const), "right"]}
        rows={[
          ...pivot.rowKeys.map((rk, i) => [
            <span key="label" className="whitespace-nowrap">
              {labels.groupValue(rowsKey, rk)}
            </span>,
            ...pivot.colKeys.map((ck, j) => cell(pivot.cells[i]?.[j] ?? null, [rowCell(rk), colCell(ck)])),
            cell(pivot.rowTotals[i] ?? null, [rowCell(rk)], true),
          ]),
          [
            <span key="total" className="font-semibold">
              {t("total")}
            </span>,
            ...pivot.colKeys.map((ck, j) => cell(pivot.colTotals[j] ?? null, [colCell(ck)], true)),
            cell(pivot.grandTotal, [], true),
          ],
        ]}
      />
    </div>
  );
}
