"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { Period } from "@capital/server/modules/ledger/contracts";
import { Btn, Popover, TextInput } from "@/components/cap";
import { MENU_ROW } from "@/components/cap/styles";
import { useFmt } from "@/lib/format/provider";
import { currentMonth, isSteppable, monthEndDate, offsetOf, PERIOD_PRESETS, presetMonths, presetOf, stepPeriod } from "@/lib/ledger/period";
import { cn } from "@/lib/utils";

/**
 * "‹ Este mês set/2026 ›" (mockup 2282–2325): the view's period, saved in
 * the view (periodNav=dirty). The menu lists the presets with their range
 * and a custom range; "voltar para o atual" resets the offset.
 */
export function PeriodControl({ period, rangeLabel, onChange }: { period: Period; rangeLabel: string; onChange: (period: Period) => void }) {
  const t = useTranslations("ledger.period");
  const fmt = useFmt();
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [from, setFrom] = useState("from" in period ? period.from : "");
  const [to, setTo] = useState("from" in period ? period.to : "");
  const preset = presetOf(period);
  const offset = offsetOf(period);
  const steppable = isSteppable(period);
  const today = currentMonth(fmt.prefs.timezone);
  const step = "h-full px-[7px] inline-flex items-center text-fg-2 hover:bg-fill-4";

  const hint = (p: (typeof PERIOD_PRESETS)[number]) => {
    if (p === preset) return "✓";
    const months = presetMonths(p, 0, today);
    return months ? fmt.periodRangeLabel(months.from, monthEndDate(months.to)) : "";
  };

  return (
    <>
      <span className="inline-flex h-(--cap-control-h) shrink-0 items-center overflow-hidden rounded-[6px] border border-stroke-1 text-button">
        {steppable ? (
          <button type="button" title={t("prev")} aria-label={t("prev")} className={cn(step, "border-r border-stroke-3")} onClick={() => onChange(stepPeriod(period, -1))}>
            ‹
          </button>
        ) : null}
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (!next) setCustom(false);
          }}
          width={230}
          trigger={
            <button type="button" className="inline-flex h-full items-center gap-1.5 px-[9px] whitespace-nowrap hover:bg-fill-4">
              <span className="text-fg-3">{preset ? t(`presets.${preset}`) : t("customLabel")}</span>
              {preset !== "all" ? <span className="font-medium">{rangeLabel}</span> : null}
            </button>
          }
        >
          <span className="text-caption text-fg-3">{t("title")}</span>
          <div className="-mx-1 flex flex-col">
            {PERIOD_PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                className={cn(MENU_ROW, "hover:bg-fill-3")}
                onClick={() => {
                  onChange({ preset: p, offset: 0 });
                  setOpen(false);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{t(`presets.${p}`)}</span>
                <span className="shrink-0 font-mono text-hint text-fg-4">{hint(p)}</span>
              </button>
            ))}
            <span className="my-1 h-px bg-stroke-3" />
            <button type="button" className={cn(MENU_ROW, "hover:bg-fill-3")} onClick={() => setCustom((v) => !v)}>
              <span className="min-w-0 flex-1 truncate">{t("custom")}</span>
              {!preset ? <span className="shrink-0 font-mono text-hint text-fg-4">✓</span> : null}
            </button>
          </div>
          {custom ? (
            <form
              className="flex flex-col gap-1.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!from || !to || from > to) return;
                onChange({ from, to });
                setOpen(false);
              }}
            >
              <div className="grid grid-cols-2 gap-1.5">
                <TextInput type="date" aria-label={t("from")} value={from} onChange={setFrom} mono />
                <TextInput type="date" aria-label={t("to")} value={to} onChange={setTo} mono />
              </div>
              <Btn primary type="submit" disabled={!from || !to || from > to}>
                {t("apply")}
              </Btn>
            </form>
          ) : null}
        </Popover>
        {steppable ? (
          <button
            type="button"
            title={t("next")}
            aria-label={t("next")}
            disabled={offset >= 0}
            className={cn(step, "border-l border-stroke-3 disabled:cursor-default disabled:text-fg-4 disabled:hover:bg-transparent")}
            onClick={() => onChange(stepPeriod(period, 1))}
          >
            ›
          </button>
        ) : null}
      </span>
      {offset !== 0 ? (
        <button type="button" className="text-label whitespace-nowrap text-fg-3 underline" onClick={() => preset && onChange({ preset, offset: 0 })}>
          {t("backToCurrent")}
        </button>
      ) : null}
    </>
  );
}
