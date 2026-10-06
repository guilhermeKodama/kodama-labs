"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { LedgerFilter, LedgerQueryResult, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { Btn, Check, Popover } from "@/components/cap";
import { MENU_ROW } from "@/components/cap/styles";
import { apiPost } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { bucketOf, GROUPABLE, type PropId } from "@/lib/ledger/columns";
import { FLOW_CATEGORY_KEYS } from "@/lib/ledger/flow-category";
import { addableProps, chipIndex, filterProp, filterValues, NONE, removeFilterAt, setChipValues } from "@/lib/ledger/filters";
import { bucketOptionsQuery } from "@/lib/ledger/view-query";
import { cn } from "@/lib/utils";
import type { LedgerLabels } from "../fields";

type Option = { value: string; label: string; hint?: string };

/** Values to pick for a property: the catalogs, or the date buckets of the view's period. */
function useOptions(prop: PropId | null, config: ViewConfig, names: Names, labels: LedgerLabels, selected: readonly string[]): { options: Option[]; loading: boolean } {
  const bucket = prop ? bucketOf(prop) : null;
  const body = bucket && bucket !== "day" ? bucketOptionsQuery(config, bucket) : null;
  const buckets = useQuery({
    queryKey: keys.ledgerQuery(body ?? {}),
    queryFn: () => apiPost<LedgerQueryResult>("/api/v2/ledger/query", body),
    enabled: body !== null,
  });
  const options = useMemo((): Option[] => {
    if (!prop) return [];
    const keep = (id: string, archived: boolean) => !archived || selected.includes(id);
    switch (prop) {
      case "entityId":
        return names.entities.filter((e) => keep(e.id, !!(e as { archivedAt?: string | null }).archivedAt)).map((e) => ({ value: e.id, label: labels.value("entityId", e.id) }));
      case "accountId":
        return names.accounts
          .filter((a) => keep(a.id, !!a.archivedAt))
          .map((a) => ({ value: a.id, label: a.name, hint: names.entity.get(a.entityId) }));
      case "categoryId":
        return [
          ...[...names.categories].filter((c) => keep(c.id, c.isArchived)).sort((a, b) => a.name.localeCompare(b.name)).map((c) => ({ value: c.id, label: c.name })),
          ...Object.values(FLOW_CATEGORY_KEYS).map((key) => ({ value: key, label: labels.value("categoryId", key) })),
          { value: NONE, label: labels.value("categoryId", null) },
        ];
      case "flowKind":
        return ["in", "out", "transfer", "invest"].map((v) => ({ value: v, label: labels.value("flowKind", v) }));
      case "currency":
        return [...new Set([...names.accounts.map((a) => a.currency), names.currency, ...selected])].sort().map((c) => ({ value: c, label: c }));
      case "isRecurring":
      case "isTaxDeductible":
        return ["true", "false"].map((v) => ({ value: v, label: labels.value(prop, v) }));
      default: {
        const found = (buckets.data?.groups ?? []).map((g) => g.key).filter((k): k is string => k !== null);
        return [...new Set([...found, ...selected])].sort().map((k) => ({ value: k, label: labels.value(prop, k) }));
      }
    }
  }, [prop, names, labels, selected, buckets.data]);
  return { options, loading: body !== null && buckets.isLoading };
}

function ChipEditor({ prop, config, names, labels, values, onValues }: { prop: PropId; config: ViewConfig; names: Names; labels: LedgerLabels; values: string[]; onValues: (values: string[]) => void }) {
  const t = useTranslations("ledger.filters");
  const tc = useTranslations("common");
  const { options, loading } = useOptions(prop, config, names, labels, values);
  return (
    <>
      <span className="text-[11px] text-fg-3">{t("is", { prop: labels.prop(prop) })}</span>
      <div className="flex flex-col gap-1.5">
        {options.map((option) => (
          <Check
            key={option.value}
            checked={values.includes(option.value)}
            onChange={(on) => onValues(on ? [...values, option.value] : values.filter((v) => v !== option.value))}
            label={
              <span className="inline-flex min-w-0 gap-1.5">
                <span className="truncate">{option.label}</span>
                {option.hint ? <span className="truncate text-fg-3">{option.hint}</span> : null}
              </span>
            }
          />
        ))}
        {loading ? <span className="text-[12px] text-fg-3">{tc("loading")}</span> : null}
        {!loading && !options.length ? <span className="text-[12px] text-fg-3">{t("noOptions")}</span> : null}
      </div>
    </>
  );
}

/**
 * The filter chips and "+ Filtro" (mockup 2234–2362): pick a property,
 * then check its values ("Prop é…", "Pronto"). Each check changes the
 * view at once. Filters the chips cannot edit (from links, imports or
 * older views) still show with their ✕.
 */
export function FilterChips({ config, names, labels, onChange }: { config: ViewConfig; names: Names; labels: LedgerLabels; onChange: (filters: LedgerFilter[]) => void }) {
  const t = useTranslations("ledger.filters");
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PropId | null>(null);
  /** A property just picked in "Filtrar por…", shown as "Prop: escolha…" while its editor is open. */
  const [pending, setPending] = useState<PropId | null>(null);
  const filters = config.filters;

  const close = () => {
    setEditing(null);
    setPending(null);
  };
  const valuesOf = (prop: PropId) => {
    const index = chipIndex(filters, prop);
    return index < 0 ? [] : filterValues(filters[index]);
  };

  const chip = (key: string, text: string, prop: PropId | null, onRemove: () => void) => {
    const open = prop !== null && editing === prop;
    const label = (
      <button type="button" disabled={!prop} className="h-full max-w-[320px] truncate px-2 text-left whitespace-nowrap disabled:cursor-default">
        {text}
      </button>
    );
    return (
      <span key={key} className={cn("inline-flex h-6 shrink-0 items-center overflow-hidden rounded-[6px] border border-stroke-2 text-[12px]", open ? "bg-fill-2" : "bg-fill-4")}>
        {prop ? (
          <Popover open={open} onOpenChange={(next) => (next ? setEditing(prop) : close())} width={260} trigger={label}>
            <ChipEditor prop={prop} config={config} names={names} labels={labels} values={valuesOf(prop)} onValues={(values) => onChange(setChipValues(filters, prop, values, config.dateField))} />
            <div className="flex gap-1.5">
              <Btn primary onClick={close}>
                {t("done")}
              </Btn>
            </div>
          </Popover>
        ) : (
          label
        )}
        <button type="button" title={t("remove")} aria-label={t("remove")} className="h-full border-l border-stroke-3 px-[7px] text-fg-3 hover:text-fg-strong" onClick={onRemove}>
          ✕
        </button>
      </span>
    );
  };

  const pendingShown = pending !== null && chipIndex(filters, pending) < 0;
  return (
    <>
      {filters.map((filter, index) => {
        const prop = filterProp(filter);
        return chip(`${index}:${filter.field}`, labels.filterLabel(filter), prop, () => {
          if (prop === editing) close();
          onChange(removeFilterAt(filters, index));
        });
      })}
      {pendingShown ? chip(`pending:${pending}`, labels.filterLabel(null, pending), pending, close) : null}
      <Popover
        open={adding}
        onOpenChange={setAdding}
        width={220}
        trigger={
          <Btn dashed>
            {t("add")}
          </Btn>
        }
      >
        <span className="text-[11px] text-fg-3">{t("filterBy")}</span>
        <div className="-mx-1 flex flex-col">
          {addableProps(filters, GROUPABLE).map((prop) => (
            <button
              key={prop}
              type="button"
              className={cn(MENU_ROW, "hover:bg-fill-3")}
              onClick={() => {
                setAdding(false);
                setPending(prop);
                // Open the editor once the menu has closed, so it anchors to the new chip.
                setTimeout(() => setEditing(prop), 0);
              }}
            >
              {labels.prop(prop)}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}
