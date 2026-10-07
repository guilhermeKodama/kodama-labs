"use client";

import { useTranslations } from "next-intl";
import type { LedgerGroup } from "@capital/server/modules/ledger/contracts";
import { useFmt } from "@/lib/format/provider";
import { calendarDays, dayIso, dayShade, monthGrid, outsideCount, rowsByDay } from "@/lib/ledger/calendar";
import { cn } from "@/lib/utils";
import type { DisplayRow } from "../rows";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const SHADE = { 0: "", 2: "bg-fill-2", 3: "bg-fill-3", 4: "bg-fill-4" } as const;

/**
 * Calendar (mockup 2994–3055): the last month of the period, Monday
 * first. Each day shows the net Σ of its counted rows, its first two
 * descriptions (each opens the detail) and "+N"; the background is
 * stronger on busier days. The day number opens the table for that day.
 * Totals come from the day groups of the whole period; the descriptions
 * from the month's own rows.
 */
export function CalendarView({
  month,
  today,
  dateField,
  rows,
  groups,
  periodCount,
  onOpen,
  onDay,
}: {
  /** "YYYY-MM". */
  month: string;
  /** "YYYY-MM-DD" in the user's timezone. */
  today: string;
  dateField: "date" | "effectiveDate";
  /** Counted rows of the month, largest first. */
  rows: readonly DisplayRow[];
  /** Day groups of the period (key YYYY-MM-DD): Σ and count. */
  groups: readonly LedgerGroup[];
  /** Counted rows in the whole period, for "N de outros meses". */
  periodCount: number;
  onOpen: (row: DisplayRow) => void;
  onDay: (day: string) => void;
}) {
  const t = useTranslations("ledger.calendar");
  const fmt = useFmt();
  const { days, lead, cells } = monthGrid(month);
  const byDay = calendarDays(groups, month);
  const rowsOf = rowsByDay(rows, dateField);
  const outside = outsideCount(byDay, periodCount);

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((d) => (
          <span key={d} className="px-1 text-caption text-fg-3">
            {t(`weekdays.${d}`)}
          </span>
        ))}
        {Array.from({ length: cells }, (_, i) => {
          const day = i - lead + 1;
          if (day < 1 || day > days) return <span key={i} />;
          const iso = dayIso(month, day);
          const { total, count } = byDay.get(iso) ?? { total: 0, count: 0 };
          const items = (rowsOf.get(iso) ?? []).slice(0, 2);
          const isToday = iso === today;
          return (
            <div key={i} className={cn("flex min-h-[74px] min-w-0 flex-col gap-[3px] rounded-[6px] border border-stroke-3 p-1.5", SHADE[dayShade(total)])}>
              <div className="flex items-baseline">
                <button
                  type="button"
                  title={t("openDay", { day: fmt.date(iso) })}
                  onClick={() => onDay(iso)}
                  className={cn("font-mono text-caption tabular-nums hover:underline", isToday ? "font-bold text-fg-1" : "text-fg-3")}
                >
                  {day}
                </button>
                {count > 0 ? <span className={cn("ml-auto font-mono text-caption font-semibold tabular-nums", total > 0 ? "text-pos" : "text-fg-1")}>{fmt.money0(total)}</span> : null}
              </div>
              {items.map((row) => (
                <button key={row.id} type="button" onClick={() => onOpen(row)} className="truncate text-left text-caption text-fg-2 hover:underline">
                  {row.description}
                </button>
              ))}
              {count > 2 ? <span className="text-hint text-fg-4">{t("more", { count: count - 2 })}</span> : null}
            </div>
          );
        })}
      </div>
      <span className="text-body-sm text-fg-4">
        {t("caption", { month: fmt.monthLabel(month) })}
        {outside ? ` · ${t("outside", { count: outside })}` : ""}
      </span>
    </div>
  );
}
