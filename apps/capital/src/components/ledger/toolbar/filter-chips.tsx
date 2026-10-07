"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { LedgerFilter, LedgerQueryResult, ViewConfig } from "@capital/server/modules/ledger/contracts";
import { apiPost } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { bucketOf, GROUPABLE, type PropId } from "@/lib/ledger/columns";
import { ledgerChipKeys } from "@/lib/ledger/chip-keys";
import { FLOW_CATEGORY_KEYS } from "@/lib/ledger/flow-category";
import { addableProps, chipIndex, filterProp, filterValues, NONE, removeFilterAt, setChipValues } from "@/lib/ledger/filters";
import { bucketOptionsQuery } from "@/lib/ledger/view-query";
import type { LedgerLabels } from "../fields";
import { ChipBar, ChipValuesEditor, type ChipOption, type FilterChip } from "./chip-bar";

type Option = ChipOption;

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

function LedgerChipEditor({ prop, config, names, labels, values, onValues }: { prop: PropId; config: ViewConfig; names: Names; labels: LedgerLabels; values: string[]; onValues: (values: string[]) => void }) {
  const t = useTranslations("ledger.filters");
  const { options, loading } = useOptions(prop, config, names, labels, values);
  return <ChipValuesEditor title={t("is", { prop: labels.prop(prop) })} options={options} values={values} onValues={onValues} loading={loading} />;
}

/**
 * The filter chips and "+ Filtro" of a ledger view (mockup 2234–2362, see
 * ChipBar): pick a property, then check its values ("Prop é…", "Pronto").
 * Each check changes the view at once. Filters the chips cannot edit (from
 * links, imports or older views) still show with their ✕.
 */
export function FilterChips({ config, names, labels, onChange }: { config: ViewConfig; names: Names; labels: LedgerLabels; onChange: (filters: LedgerFilter[]) => void }) {
  const filters = config.filters;
  const valuesOf = (prop: PropId) => {
    const index = chipIndex(filters, prop);
    return index < 0 ? [] : filterValues(filters[index]);
  };
  const chipKeys = ledgerChipKeys(filters);
  const chips: FilterChip<PropId>[] = filters.map((filter, index) => {
    const prop = filterProp(filter);
    // The first filter on a property is its chip; any other shows with its ✕ only.
    const editsProp = prop !== null && chipIndex(filters, prop) === index;
    return {
      key: chipKeys[index],
      text: labels.filterLabel(filter),
      prop: editsProp ? prop : null,
      onRemove: () => onChange(removeFilterAt(filters, index)),
    };
  });
  return (
    <ChipBar
      chips={chips}
      addable={addableProps(filters, GROUPABLE)}
      propLabel={labels.prop}
      pendingText={(prop) => labels.filterLabel(null, prop)}
      editor={(prop) => (
        <LedgerChipEditor prop={prop} config={config} names={names} labels={labels} values={valuesOf(prop)} onValues={(values) => onChange(setChipValues(filters, prop, values, config.dateField))} />
      )}
    />
  );
}
