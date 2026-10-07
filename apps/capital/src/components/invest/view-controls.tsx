"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { Btn, Check, Field, Menu, MenuItem, Popover, Segmented, Select, TextInput } from "@/components/cap";
import { ChipBar, ChipValuesEditor, type FilterChip } from "@/components/ledger/toolbar/chip-bar";
import { DeleteViewButton } from "@/components/ledger/toolbar/delete-view";
import { LayoutIcon } from "@/components/ledger/toolbar/layout-icon";
import { RenameInput, useViewMenu, ViewMenu, ViewMenuTarget } from "@/components/ledger/toolbar/view-menu";
import { useNames } from "@/lib/api/catalog";
import { filterOptions, HOLDINGS_FILTER_FIELDS, HOLDINGS_SORT_FIELDS, type HoldingsFilter, type HoldingsViewConfig } from "@/lib/invest/holdings-view";
import type { OpsFilter, OpsViewConfig } from "@/lib/invest/ops-view";
import { ALLOCATION_CLASSES, type Holding, type PortfolioSummary } from "@/lib/invest/types";
import { fieldChipKeys } from "@/lib/ledger/chip-keys";
import { addableFields, fieldChipIndex, fieldChipValues, setFieldChipValues, type FieldFilter } from "@/lib/ledger/field-filters";
import { cn } from "@/lib/utils";
import type { InvestDataset, InvestView, InvestViewWrites } from "./use-invest-views";

const OPS_TYPES = ["buy", "sell", "dividend", "yield_payment", "split", "deposit", "withdrawal", "adjustment"] as const;
const OPS_FILTER_FIELDS = ["type", "accountId", "allocationClass"] as const;
const PERIOD_PRESETS = ["last_12m", "ytd", "last_3m", "this_month", "last_month", "all"] as const;
const HOLDINGS_COLUMNS = ["allocationClass", "accountId", "entityId", "marketValue", "share", "result"] as const;

type FilterField = (typeof HOLDINGS_FILTER_FIELDS)[number] | (typeof OPS_FILTER_FIELDS)[number];

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

/**
 * The view's filters as chips, and "+ Filtro": the same property → values →
 * Pronto editor as Transações (ChipBar). Each check is saved with the view
 * through the auto-save queue.
 */
export function InvestFilterChips({ view, writes, holdings, summary }: { view: InvestView; writes: InvestViewWrites; holdings: Holding[]; summary: PortfolioSummary | undefined }) {
  const t = useTranslations("invest.portfolio");
  const tl = useTranslations("ledger.filters");
  const label = useValueLabel();
  const names = useNames();
  const filters = view.config.filters as FieldFilter<FilterField>[];
  const fields: readonly FilterField[] = view.dataset === "holdings" ? HOLDINGS_FILTER_FIELDS : OPS_FILTER_FIELDS;
  const fieldLabel = (field: FilterField) => t(`filter.field.${field}`);
  const optionsOf = (field: FilterField): string[] => {
    if (view.dataset === "holdings") return filterOptions(holdings, summary?.brokers ?? [], field as (typeof HOLDINGS_FILTER_FIELDS)[number]);
    if (field === "type") return [...OPS_TYPES];
    if (field === "allocationClass") return ALLOCATION_CLASSES.filter((c) => c !== "cash");
    return names.accounts.filter((a) => a.type === "brokerage").map((a) => a.id);
  };
  const save = (next: FieldFilter<FilterField>[]) => writes.update(view, { config: { ...view.config, filters: next as HoldingsFilter[] | OpsFilter[] } });

  const chipKeys = fieldChipKeys(filters);
  const chips: FilterChip<FilterField>[] = filters.map((f, index) => {
    const editable = fieldChipIndex(filters, f.field) === index;
    return {
      key: chipKeys[index],
      text: t(f.op === "nin" ? "filter.chipNot" : "filter.chip", { field: fieldLabel(f.field), values: f.values.map((v) => label(f.field, v)).join(", ") }),
      prop: editable ? f.field : null,
      onRemove: () => save(filters.filter((_, i) => i !== index)),
    };
  });
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <ChipBar
        chips={chips}
        addable={addableFields(filters, fields)}
        propLabel={fieldLabel}
        pendingText={(field) => tl("choose", { prop: fieldLabel(field) })}
        editor={(field) => (
          <ChipValuesEditor
            title={tl("is", { prop: fieldLabel(field) })}
            options={optionsOf(field).map((value) => ({ value, label: label(field, value) }))}
            values={fieldChipValues(filters, field)}
            onValues={(values) => save(setFieldChipValues(filters, field, values))}
          />
        )}
        trailing={
          filters.length ? (
            <Btn ghost onClick={() => save([])}>
              {t("filter.clear")}
            </Btn>
          ) : null
        }
      />
    </div>
  );
}

/**
 * "Exibição": grouping, order and columns of a positions view; layout,
 * period and series of an operations view; its name. Controlled and
 * mounted per view (key = view.id), so its name field never carries over
 * to another view. Deleting is the "×" next to the tab's name.
 */
export function DisplayPopover({ view, writes }: { view: InvestView; writes: InvestViewWrites }) {
  const t = useTranslations("invest.portfolio.display");
  const tp = useTranslations("invest.portfolio");
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(view.name);
  const save = (config: HoldingsViewConfig | OpsViewConfig) => writes.update(view, { config });
  const rename = () => {
    const next = name.trim();
    if (next && next !== view.name) writes.update(view, { name: next });
  };
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setName(view.name);
        else rename();
        setOpen(next);
      }}
      trigger={<Btn>{tp("tabs.display")}</Btn>}
      align="end"
      width={280}
    >
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
    </Popover>
  );
}

function InvestViewTab({ view, on, onSelect, onOpen, writes, onDelete }: { view: InvestView; on: boolean; onSelect: () => void; onOpen: (id: string) => void; writes: InvestViewWrites; onDelete: () => void }) {
  const menu = useViewMenu();
  const [renaming, setRenaming] = useState(false);
  const editable = view.persisted;
  return (
    <ViewMenuTarget
      onContextMenu={editable && !renaming ? menu.onContextMenu : undefined}
      className={cn("inline-flex h-[34px] shrink-0 items-center gap-0.5 border-b-2", on ? "border-fg-1" : "border-transparent")}
    >
      {renaming ? (
        // The menu is unmounted while renaming, so closing it cannot take the focus back from the field.
        <span className="inline-flex items-center gap-1.5 px-2">
          <LayoutIcon layout={view.config.layout} />
          <RenameInput
            name={view.name}
            className="w-[150px]"
            onDone={(name) => {
              setRenaming(false);
              if (name) writes.update(view, { name });
            }}
          />
        </span>
      ) : (
        <>
          <button
            type="button"
            onClick={onSelect}
            onDoubleClick={editable ? () => setRenaming(true) : undefined}
            className={cn(
              "inline-flex h-full items-center gap-1.5 pl-2 text-[12.5px] whitespace-nowrap outline-none focus-visible:bg-fill-4",
              editable ? "pr-0.5" : "pr-2",
              on ? "font-medium text-fg-1" : "text-fg-3 hover:text-fg-strong",
            )}
          >
            <LayoutIcon layout={view.config.layout} />
            {view.name}
          </button>
          {editable ? <DeleteViewButton name={view.name} visible={on} onDelete={onDelete} /> : null}
          {editable ? (
            <ViewMenu
              label={view.name}
              open={menu.open}
              onOpenChange={menu.setOpen}
              visible={on}
              className="mr-1"
              actions={{
                onRename: () => setRenaming(true),
                onDuplicate: () => writes.duplicate.mutate({ view }, { onSuccess: (copy) => onOpen(copy.id) }),
              }}
            />
          ) : null}
        </>
      )}
    </ViewMenuTarget>
  );
}

/**
 * The Carteira tabs (positions and operations views), each with "×" to
 * delete it (after a confirmation; deleting the open one opens the first
 * tab left) and its menu ("⋯" or right click: Renomear, Duplicar), "+"
 * for a new view of either dataset, then "+ Filtro" chips and Exibição of
 * the active view. With every view deleted the strip holds only "+".
 */
export function InvestViewTabs({
  views,
  active,
  onSelect,
  writes,
  canCreate,
  holdings,
  summary,
}: {
  views: InvestView[];
  active: InvestView | null;
  /** Opens a view by id (null: the first one). */
  onSelect: (id: string | null) => void;
  writes: InvestViewWrites;
  canCreate: boolean;
  holdings: Holding[];
  summary: PortfolioSummary | undefined;
}) {
  const t = useTranslations("invest.portfolio.tabs");
  const editable = !!active?.persisted;
  const create = (dataset: InvestDataset, config: object) => writes.create.mutate({ dataset, config }, { onSuccess: (view) => onSelect(view.id) });
  const remove = (view: InvestView) => {
    // A second click while the delete is on its way would 404 (and toast an error).
    if (writes.remove.isPending && writes.remove.variables?.id === view.id) return;
    writes.remove.mutate(view, {
      onSuccess: () => {
        if (view.id === active?.id) onSelect(null);
      },
    });
  };
  return (
    <>
      <div className="flex items-center gap-0.5 overflow-x-auto border-b border-stroke-3">
        {views.map((v) => (
          <InvestViewTab key={v.id} view={v} on={v.id === active?.id} onSelect={() => onSelect(v.id)} onOpen={onSelect} writes={writes} onDelete={() => remove(v)} />
        ))}
        {canCreate ? (
          <Menu
            trigger={
              <button
                type="button"
                aria-label={t("addView")}
                title={t("addView")}
                className="inline-flex size-6 shrink-0 items-center justify-center rounded-[6px] text-fg-3 hover:bg-fill-3 hover:text-fg-1"
              >
                <Plus aria-hidden className="size-3.5" />
              </button>
            }
            width={220}
          >
            <MenuItem label={t("newHoldingsView")} onSelect={() => create("holdings", { groupBy: "none" })} />
            <MenuItem label={t("newOpsView")} onSelect={() => create("investment_ops", { layout: "table", period: { preset: "all", offset: 0 } })} />
          </Menu>
        ) : null}
        {active && editable ? (
          <span className="ml-auto flex shrink-0 items-center gap-1.5">
            <DisplayPopover key={active.id} view={active} writes={writes} />
          </span>
        ) : null}
      </div>
      {active && editable ? <InvestFilterChips key={active.id} view={active} writes={writes} holdings={holdings} summary={summary} /> : null}
    </>
  );
}
