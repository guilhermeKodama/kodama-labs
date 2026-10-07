"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import type { ViewConfig } from "@capital/server/modules/ledger/contracts";
import { Btn, Check, Popover, Select, TextInput } from "@/components/cap";
import {
  CHART_TYPE_META,
  displayFields,
  groupByOf,
  groupIdOf,
  groupOptions,
  groupTitleKey,
  LAYOUTS,
  METRICS,
  PROP_IDS,
  SORT_IDS,
  SORTS,
  sortIdOf,
  subTitleKey,
  toggleColumn,
  TOPS,
} from "@/lib/ledger/columns";
import { PERIOD_PRESETS, presetOf } from "@/lib/ledger/period";
import { LAYOUT_ICON } from "@/lib/ledger/view-glyphs";
import { cn } from "@/lib/utils";
import type { LedgerLabels } from "../fields";

/** Label (92px, 12px tertiary) and control on one line (mockup FieldRow 2037). */
function FieldRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-[92px] shrink-0 text-body-sm text-fg-3">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

const TOP_LABEL: Record<(typeof TOPS)[number], "all" | "top5" | "top8"> = { 0: "all", 5: "top5", 8: "top8" };

/**
 * "Exibição" (mockup 2365–2522): name, layout, period, grouping, chart
 * options, sort, visible properties, favorite, then Duplicar / Fechar
 * pinned at the bottom (a view is deleted with the "×" next to its name). Every change applies at once
 * (auto-save; on Todas only display preferences are kept). Open state
 * lives in the URL (?display=1).
 */
export function DisplayMenu({
  open,
  onOpenChange,
  name,
  isBuiltin,
  isFavorite,
  config,
  labels,
  onRename,
  onFavorite,
  onConfig,
  onDuplicate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  isBuiltin: boolean;
  isFavorite: boolean;
  config: ViewConfig;
  labels: LedgerLabels;
  onRename: (name: string) => void;
  onFavorite: (value: boolean) => void;
  onConfig: (patch: Partial<ViewConfig>) => void;
  onDuplicate: () => void;
}) {
  const t = useTranslations("ledger");
  // Mounted per view (keyed by the screen), so the name typed here is the source while it is open.
  const [draftName, setDraftName] = useState(name);
  const fields = displayFields(config);
  const chart = config.chart;
  const g1 = groupIdOf(config.groupBy[0]);
  const g2 = groupIdOf(config.groupBy[1]);
  const options = groupOptions(config.layout).map((id) => ({ value: id, label: labels.prop(id) }));
  const setGroups = (a: string, b: string) => onConfig({ groupBy: groupByOf(config.layout, chart.type, a, b) });
  const sortId = sortIdOf(config.sort);
  const preset = presetOf(config.period);

  return (
    <Popover open={open} onOpenChange={onOpenChange} align="end" width={340} trigger={<Btn>{t("display.button")}</Btn>}>
      <FieldRow label={t("display.name")}>
        <TextInput
          value={draftName}
          disabled={isBuiltin}
          className="w-full"
          onChange={(value) => {
            setDraftName(value);
            if (value.trim()) onRename(value.trim());
          }}
        />
      </FieldRow>
      {isBuiltin ? <span className="text-label text-fg-3">{t("display.builtinHint")}</span> : null}
      <div className="flex flex-col gap-1.5">
        <span className="text-body-sm text-fg-3">{t("display.layout")}</span>
        <div className="grid grid-cols-3 gap-1.5">
          {LAYOUTS.map((layout) => {
            const Icon = LAYOUT_ICON[layout];
            const on = config.layout === layout;
            return (
              <button
                key={layout}
                type="button"
                aria-pressed={on}
                onClick={() => onConfig({ layout })}
                className={cn(
                  "flex h-14 flex-col items-center justify-center gap-1 rounded-[8px] border text-label outline-none focus-visible:ring-2 focus-visible:ring-fg-3/40",
                  on ? "border-fg-1 bg-fill-2 font-medium text-fg-1" : "border-stroke-2 text-fg-3 hover:bg-fill-4 hover:text-fg-strong",
                )}
              >
                <Icon aria-hidden className="size-5" />
                {t(`layouts.${layout}`)}
              </button>
            );
          })}
        </div>
      </div>
      <FieldRow label={t("display.period")}>
        <Select
          value={preset}
          placeholder={t("display.custom")}
          className="w-full"
          onChange={(value) => onConfig({ period: { preset: value as (typeof PERIOD_PRESETS)[number], offset: 0 } })}
          options={PERIOD_PRESETS.map((p) => ({ value: p, label: t(`period.presets.${p}`) }))}
        />
      </FieldRow>
      {fields.group ? (
        <>
          <FieldRow label={t(`display.group.${groupTitleKey(config.layout)}`)}>
            <Select value={g1} placeholder={t("display.custom")} className="w-full" onChange={(value) => setGroups(value, value === "none" ? "none" : g2)} options={options} />
          </FieldRow>
          <span className="-mt-1 text-caption text-fg-4">{t("display.groupHint")}</span>
        </>
      ) : null}
      {fields.chartType ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm text-fg-3">{t("display.chartType")}</span>
          <div className="grid grid-cols-3 gap-1">
            {CHART_TYPE_META.map(({ type, icon: Icon }) => (
              <button
                key={type}
                type="button"
                aria-pressed={chart.type === type}
                onClick={() => onConfig({ chart: { ...chart, type } })}
                className={cn(
                  "flex items-center gap-1.5 rounded-[6px] border px-2 py-[5px] text-label",
                  chart.type === type ? "border-fg-1 bg-fill-2 text-fg-1" : "border-stroke-2 text-fg-3 hover:text-fg-strong",
                )}
              >
                <Icon aria-hidden className="size-3.5 shrink-0" />
                <span className="truncate">{t(`charts.types.${type}`)}</span>
              </button>
            ))}
          </div>
          <span className="text-caption text-fg-4">{t(`charts.hints.${chart.type}`)}</span>
        </div>
      ) : null}
      {fields.metric ? (
        <FieldRow label={t("display.metric")}>
          <Select
            value={chart.metric}
            className="w-full"
            onChange={(value) => onConfig({ chart: { ...chart, metric: value as ViewConfig["chart"]["metric"] } })}
            options={METRICS.map((m) => ({ value: m, label: t(`charts.metrics.${m}`) }))}
          />
        </FieldRow>
      ) : null}
      {fields.top ? (
        <FieldRow label={t("display.top")}>
          <Select
            value={String(chart.top)}
            placeholder={t("display.custom")}
            className="w-full"
            onChange={(value) => onConfig({ chart: { ...chart, top: Number(value) } })}
            options={TOPS.map((n) => ({ value: String(n), label: t(`charts.tops.${TOP_LABEL[n]}`) }))}
          />
        </FieldRow>
      ) : null}
      {fields.cumulative ? <Check checked={chart.cumulative} onChange={(value) => onConfig({ chart: { ...chart, cumulative: value } })} label={t("display.cumulative")} /> : null}
      {fields.sub ? (
        <FieldRow label={t(`display.group.${subTitleKey(config.layout)}`)}>
          <Select value={g2} placeholder={t("display.custom")} className="w-full" onChange={(value) => setGroups(g1, value)} options={options} />
        </FieldRow>
      ) : null}
      {fields.sort ? (
        <FieldRow label={t("display.sort")}>
          <Select
            value={sortId}
            placeholder={t("display.custom")}
            className="w-full"
            onChange={(value) => onConfig({ sort: SORTS[value as (typeof SORT_IDS)[number]] })}
            options={SORT_IDS.map((id) => ({ value: id, label: t(`sorts.${id}`) }))}
          />
        </FieldRow>
      ) : null}
      {fields.props ? (
        <div className="flex flex-col gap-1.5">
          <span className="text-body-sm text-fg-3">{t("display.props")}</span>
          <div className="flex flex-wrap gap-1">
            {PROP_IDS.map((id) => {
              const on = config.columns.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onConfig({ columns: toggleColumn(config.columns, id) })}
                  className={cn("rounded-[5px] border px-[7px] py-0.5 text-label", on ? "border-stroke-1 bg-fill-2 text-fg-1" : "border-stroke-3 text-fg-4 hover:text-fg-2")}
                >
                  {labels.prop(id)}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      <Check checked={isFavorite} onChange={onFavorite} label={t("display.favorite")} />
      {/* Pinned to the bottom of the popover, reachable however long the options get. */}
      <div className="sticky bottom-0 -mx-2.5 -mb-2.5 flex shrink-0 items-center gap-1.5 border-t border-stroke-3 bg-editor px-2.5 py-2">
        <Btn onClick={onDuplicate}>{t("display.duplicate")}</Btn>
        <Btn ghost onClick={() => onOpenChange(false)}>
          {t("display.close")}
        </Btn>
      </div>
    </Popover>
  );
}
