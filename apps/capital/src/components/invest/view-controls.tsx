"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Btn, Check, Field, Menu, MenuCheckItem, MenuLabel, MenuSep, Pill, Popover, Segmented, Select, TextInput } from "@/components/cap";
import { useNames } from "@/lib/api/catalog";
import { filterOptions, HOLDINGS_FILTER_FIELDS, HOLDINGS_SORT_FIELDS, toggleFilterValue, type HoldingsFilter, type HoldingsViewConfig } from "@/lib/invest/holdings-view";
import type { OpsFilter, OpsViewConfig } from "@/lib/invest/ops-view";
import { ALLOCATION_CLASSES, type Holding, type PortfolioSummary } from "@/lib/invest/types";
import type { InvestView, useInvestViewWrites } from "./use-invest-views";

type Writes = ReturnType<typeof useInvestViewWrites>;

const OPS_TYPES = ["buy", "sell", "dividend", "yield_payment", "split", "deposit", "withdrawal", "adjustment"] as const;
const OPS_FILTER_FIELDS = ["type", "accountId", "allocationClass"] as const;
const PERIOD_PRESETS = ["last_12m", "ytd", "last_3m", "this_month", "last_month", "all"] as const;
const HOLDINGS_COLUMNS = ["allocationClass", "accountId", "entityId", "marketValue", "share", "result"] as const;

/** A label for a filter value (class, broker, entity or operation type). */
function useValueLabel() {
  const ti = useTranslations("invest");
  const names = useNames();
  return (field: string, value: string) => {
    switch (field) {
      case "allocationClass":
        return ti(`allocationClass.${value as "cash"}`);
      case "accountId":
        return names.account.get(value) ?? value;
      case "entityId":
        return names.entity.get(value) ?? value;
      case "type":
        return ti(`opType.${value as "buy"}`);
      default:
        return value;
    }
  };
}

function saveFilters(view: InvestView, writes: Writes, filters: HoldingsFilter[] | OpsFilter[]) {
  writes.update.mutate({ view, patch: { config: { ...view.config, filters } } });
}

/** "+ Filtro": values per field, toggled into the view's filters (saved with the view). */
export function FilterMenu({ view, writes, holdings, summary }: { view: InvestView; writes: Writes; holdings: Holding[]; summary: PortfolioSummary | undefined }) {
  const t = useTranslations("invest.portfolio");
  const label = useValueLabel();
  const names = useNames();
  const fields: { field: string; values: string[] }[] =
    view.dataset === "holdings"
      ? HOLDINGS_FILTER_FIELDS.map((field) => ({ field, values: filterOptions(holdings, summary?.brokers ?? [], field) }))
      : OPS_FILTER_FIELDS.map((field) => ({
          field,
          values:
            field === "type"
              ? [...OPS_TYPES]
              : field === "allocationClass"
                ? ALLOCATION_CLASSES.filter((c) => c !== "cash")
                : names.accounts.filter((a) => a.type === "brokerage").map((a) => a.id),
        }));
  const filters = view.config.filters as (HoldingsFilter | OpsFilter)[];
  const isOn = (field: string, value: string) => filters.some((f) => f.field === field && f.op === "in" && f.values.includes(value));
  const toggle = (field: string, value: string) => saveFilters(view, writes, toggleFilterValue(filters as HoldingsFilter[], field as HoldingsFilter["field"], value));
  return (
    <Menu trigger={<Btn dashed>{t("tabs.filter")}</Btn>} align="end" width={240}>
      {fields.map(({ field, values }, i) => (
        <div key={field}>
          {i ? <MenuSep /> : null}
          <MenuLabel>{t(`filter.field.${field}`)}</MenuLabel>
          {values.map((value) => (
            <MenuCheckItem key={value} label={label(field, value)} checked={isOn(field, value)} onChange={() => toggle(field, value)} />
          ))}
        </div>
      ))}
    </Menu>
  );
}

/** The view's filters as chips under the tabs; ✕ removes one. */
export function FilterChips({ view, writes }: { view: InvestView; writes: Writes }) {
  const t = useTranslations("invest.portfolio");
  const label = useValueLabel();
  const filters = view.config.filters as (HoldingsFilter | OpsFilter)[];
  if (!filters.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {filters.map((f) => (
        <Pill
          key={`${f.field}:${f.op}`}
          active
          onClick={() => saveFilters(view, writes, filters.filter((x) => x !== f) as HoldingsFilter[])}
          aria-label={t("filter.remove")}
          hint="✕"
        >
          {t(f.op === "nin" ? "filter.chipNot" : "filter.chip", { field: t(`filter.field.${f.field}`), values: f.values.map((v) => label(f.field, v)).join(", ") })}
        </Pill>
      ))}
      <Btn ghost onClick={() => saveFilters(view, writes, [])}>
        {t("filter.clear")}
      </Btn>
    </div>
  );
}

/** "Exibição": grouping, order and columns of a positions view; layout, period and series of an operations view; name and delete. */
export function DisplayPopover({ view, writes, onDeleted }: { view: InvestView; writes: Writes; onDeleted: () => void }) {
  const t = useTranslations("invest.portfolio.display");
  const tp = useTranslations("invest.portfolio");
  const [name, setName] = useState(view.name);
  const save = (config: HoldingsViewConfig | OpsViewConfig) => writes.update.mutate({ view, patch: { config } });
  const rename = () => {
    const next = name.trim();
    if (next && next !== view.name) writes.update.mutate({ view, patch: { name: next } });
  };
  return (
    <Popover trigger={<Btn>{tp("tabs.display")}</Btn>} align="end" width={280} onOpenChange={(open) => (open ? setName(view.name) : rename())}>
      <Field label={t("name")}>
        <TextInput value={name} onChange={setName} onBlur={rename} onKeyDown={(event) => event.key === "Enter" && rename()} />
      </Field>
      {view.dataset === "holdings" ? (
        <>
          <Field label={t("groupBy")}>
            <Select
              value={view.config.groupBy}
              onChange={(groupBy) => save({ ...view.config, groupBy: groupBy as HoldingsViewConfig["groupBy"] })}
              options={(["allocationClass", "accountId", "entityId", "none"] as const).map((v) => ({ value: v, label: t(`group.${v}`) }))}
            />
          </Field>
          <Field label={t("sortBy")}>
            <div className="flex gap-1.5">
              <Select
                className="flex-1"
                value={view.config.sort.field}
                onChange={(field) => save({ ...view.config, sort: { ...view.config.sort, field: field as HoldingsViewConfig["sort"]["field"] } })}
                options={HOLDINGS_SORT_FIELDS.map((v) => ({ value: v, label: t(`sort.${v}`) }))}
              />
              <Segmented
                value={view.config.sort.dir}
                options={[
                  { v: "desc", l: "↓" },
                  { v: "asc", l: "↑" },
                ]}
                onChange={(dir) => save({ ...view.config, sort: { ...view.config.sort, dir } })}
                aria-label={t("direction")}
              />
            </div>
          </Field>
          <Field label={t("columns")}>
            <div className="grid grid-cols-2 gap-1">
              {HOLDINGS_COLUMNS.map((c) => (
                <Check
                  key={c}
                  checked={view.config.columns.includes(c)}
                  label={tp(`columns.${c}`)}
                  onChange={(on) => {
                    const config = view.config as HoldingsViewConfig;
                    save({ ...config, columns: on ? [...config.columns, c] : config.columns.filter((x) => x !== c) });
                  }}
                />
              ))}
            </div>
          </Field>
        </>
      ) : (
        <>
          <Field label={t("layout")}>
            <Segmented
              value={view.config.layout}
              options={[
                { v: "table", l: t("layoutTable") },
                { v: "chart", l: t("layoutChart") },
              ]}
              onChange={(layout) => save({ ...view.config, layout })}
            />
          </Field>
          <Field label={t("period")}>
            <Select
              value={"preset" in view.config.period ? view.config.period.preset : "all"}
              onChange={(preset) => save({ ...view.config, period: { preset: preset as (typeof PERIOD_PRESETS)[number], offset: 0 } })}
              options={PERIOD_PRESETS.map((v) => ({ value: v, label: t(`periods.${v}`) }))}
            />
          </Field>
          {view.config.layout === "chart" ? (
            <Field label={t("series")}>
              <Segmented
                value={view.config.series === "allocationClass" ? "allocationClass" : "none"}
                options={[
                  { v: "none", l: t("seriesTotal") },
                  { v: "allocationClass", l: t("seriesClass") },
                ]}
                onChange={(series) => save({ ...(view.config as OpsViewConfig), series })}
              />
            </Field>
          ) : null}
        </>
      )}
      <div className="border-t border-stroke-3 pt-2">
        <Btn ghost danger onClick={() => writes.remove.mutate(view, { onSuccess: onDeleted })}>
          {t("delete")}
        </Btn>
      </div>
    </Popover>
  );
}
