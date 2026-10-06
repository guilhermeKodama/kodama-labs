"use client";

import { useTranslations } from "next-intl";
import type { LedgerGroup } from "@capital/server/modules/ledger/contracts";
import { useFmt } from "@/lib/format/provider";
import { COUNT_KEY, SUM_KEY } from "@/lib/ledger/columns";
import { cn } from "@/lib/utils";
import type { DisplayRow } from "../rows";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;

/**
 * Calendar (mockup 2994–3055): the last month of the period, Monday
 * first. Each day shows the net Σ of its counted rows, its first two
 * descriptions (each opens the detail) and "+N"; the background is
 * stronger on busier days. The day number opens the table for that day.
 */
export function CalendarView({
  month,
  today,
  rows,
  groups,
  totalCount,
  onOpen,
  onDay,
}: {
  /** "YYYY-MM". */
  month: string;
  /** "YYYY-MM-DD" in the user's timezone. */
  today: string;
  rows: readonly DisplayRow[];
  /** Day groups (key YYYY-MM-DD): Σ and count. */
  groups: readonly LedgerGroup[];
  /** Rows in the whole period (counted), for "N de outros meses". */
  totalCount: number;
  onOpen: (row: DisplayRow) => void;
  onDay: (day: string) => void;
}) {
  const t = useTranslations("ledger.calendar");
  const fmt = useFmt();
  const [year, m] = month.split("-").map(Number);
  const days = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const lead = (new Date(Date.UTC(year, m - 1, 1)).getUTCDay() + 6) % 7;
  const byDay = new Map(groups.filter((g) => g.key?.startsWith(month)).map((g) => [g.key as string, g]));
  const inMonth = [...byDay.values()].reduce((s, g) => s + (g.values[COUNT_KEY] ?? g.count), 0);
  const outside = Math.max(0, totalCount - inMonth);
  const cells = Math.ceil((lead + days) / 7) * 7;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <span key={d} className="px-1 text-[11px] text-fg-3">
            {t(`weekdays.${d}`)}
          </span>
        ))}
        {Array.from({ length: cells }, (_, i) => {
          const day = i - lead + 1;
          if (day < 1 || day > days) return <span key={i} />;
          const iso = `${month}-${String(day).padStart(2, "0")}`;
          const group = byDay.get(iso);
          const total = group?.values[SUM_KEY] ?? 0;
          const count = group ? (group.values[COUNT_KEY] ?? group.count) : 0;
          const mag = Math.abs(total);
          const items = rows.filter((row) => row.date === iso).slice(0, 2);
          const isToday = iso === today;
          return (
            <div
              key={i}
              className={cn(
                "flex min-h-[74px] min-w-0 flex-col gap-[3px] rounded-[6px] border border-stroke-3 p-1.5",
                mag > 3000 ? "bg-fill-2" : mag > 500 ? "bg-fill-3" : mag > 0 ? "bg-fill-4" : "",
              )}
            >
              <div className="flex items-baseline">
                <button
                  type="button"
                  title={t("openDay", { day: fmt.date(iso) })}
                  onClick={() => onDay(iso)}
                  className={cn("font-mono text-[11px] tabular-nums hover:underline", isToday ? "font-bold text-fg-1" : "text-fg-3")}
                >
                  {day}
                </button>
                {count > 0 ? <span className={cn("ml-auto font-mono text-[11px] font-semibold tabular-nums", total > 0 ? "text-pos" : "text-fg-1")}>{fmt.money0(total)}</span> : null}
              </div>
              {items.map((row) => (
                <button key={row.id} type="button" onClick={() => onOpen(row)} className="truncate text-left text-[11px] text-fg-2 hover:underline">
                  {row.description}
                </button>
              ))}
              {count > 2 ? <span className="text-[10.5px] text-fg-4">{t("more", { count: count - 2 })}</span> : null}
            </div>
          );
        })}
      </div>
      <span className="text-[12px] text-fg-4">
        {t("caption", { month: fmt.monthLabel(month) })}
        {outside ? ` · ${t("outside", { count: outside })}` : ""}
      </span>
    </div>
  );
}
