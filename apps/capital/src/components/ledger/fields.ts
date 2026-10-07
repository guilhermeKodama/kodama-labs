"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import type { GroupKey, LedgerFilter, Period } from "@capital/server/modules/ledger/contracts";
import { apiGet } from "@/lib/api/client";
import type { Names } from "@/lib/api/catalog";
import { keys } from "@/lib/api/keys";
import { useFmt } from "@/lib/format/provider";
import { bucketKeyOf, bucketOf, groupIdOf, groupLabelKey, isPropId, type PropId } from "@/lib/ledger/columns";
import { COMPOSITE_SEPARATOR } from "@/lib/ledger/drill";
import { FLOW_CATEGORY_KEYS, isFlowCategoryKey } from "@/lib/ledger/flow-category";
import { chipText, filterProp, filterValues, hasImportFilter, importLabels, NONE, type ImportLabelSource } from "@/lib/ledger/filters";
import { presetOf } from "@/lib/ledger/period";
import type { DisplayRow } from "./rows";

/**
 * @deprecated pt-BR names of the ledger kind, for readers not yet on the
 * `ledger` messages; Transações shows the derived Tipo (flowKind) through
 * useLedgerLabels().
 */
export const KIND_LABEL: Record<string, string> = { income: "Entrada", expense: "Saída", transfer: "Transferência", investment: "Aporte" };

const NO_IMPORTS: ReadonlyMap<string, string> = new Map();

/**
 * File labels of the user's imports by id, read (GET /v2/imports, the
 * Ajustes › Importações cache) only while a filter selects by import.
 */
export function useImportLabels(filters: readonly LedgerFilter[]): ReadonlyMap<string, string> {
  const enabled = hasImportFilter(filters);
  const history = useQuery({
    queryKey: keys.imports(),
    queryFn: async () => (await apiGet<{ imports: ImportLabelSource[] }>("/api/v2/imports")).imports,
    enabled,
  });
  return useMemo(() => (enabled && history.data ? importLabels(history.data) : NO_IMPORTS), [enabled, history.data]);
}

/** Labels of Transações (properties, values, filters, periods) in the user's language; `imports` names the importId chips. */
export function useLedgerLabels(names: Names, imports: ReadonlyMap<string, string> = NO_IMPORTS) {
  const t = useTranslations("ledger");
  const fmt = useFmt();
  return useMemo(() => {
    const yesNo = (value: unknown) => (value === true || value === "true" ? t("yes") : t("no"));
    const entity = (id: string) => names.entity.get(id) ?? "—";
    const account = (id: string) => names.account.get(id) ?? "—";
    const pair = (value: string, one: (id: string) => string) =>
      value.includes(COMPOSITE_SEPARATOR) ? value.split(COMPOSITE_SEPARATOR).map(one).join(" → ") : one(value);

    /** Label of a property or group option id ("entityId", "date:month", "none", "date:day"). */
    const prop = (id: string) => t(`props.${groupLabelKey(id)}`);

    /** Label of a field value (categorical fields and date bucket keys). */
    const value = (id: string, raw: string | null): string => {
      const bucket = bucketOf(id);
      if (bucket) return raw ? fmt.bucketLabel(bucket, raw) : "—";
      if (raw === null || raw === NONE) return id === "categoryId" ? t("uncategorized") : "—";
      switch (id) {
        case "entityId":
          return pair(raw, entity);
        case "accountId":
          return pair(raw, account);
        case "categoryId":
          if (isFlowCategoryKey(raw)) return t(raw === FLOW_CATEGORY_KEYS.invest ? "categoryFlow.invest" : "categoryFlow.transfer");
          return names.category.get(raw) ?? t("uncategorized");
        case "flowKind":
          return ["in", "out", "transfer", "invest"].includes(raw) ? t(`flowKind.${raw}`) : raw;
        case "entityKind":
          return raw === "personal" || raw === "business" ? t(`entityKind.${raw}`) : raw;
        case "importId":
          return imports.get(raw) ?? raw;
        case "isRecurring":
        case "isTaxDeductible":
          return yesNo(raw);
        default:
          return raw;
      }
    };

    /** Label of a group's key. */
    const groupValue = (key: GroupKey, raw: string | null) => value(groupIdOf(key), raw);

    const rowEntity = (row: DisplayRow) =>
      row.neutral && row.counterpartEntityId && row.counterpartEntityId !== row.entityId ? `${entity(row.entityId)} → ${entity(row.counterpartEntityId)}` : entity(row.entityId);
    const rowAccount = (row: DisplayRow) =>
      row.neutral && row.counterpartAccountId ? `${account(row.accountId)} → ${account(row.counterpartAccountId)}` : account(row.accountId);
    const rowCategory = (row: DisplayRow) => {
      if (row.categoryId) return names.category.get(row.categoryId) ?? t("uncategorized");
      if (row.flowKind === "transfer" || row.flowKind === "invest") return t(`categoryFlow.${row.flowKind}`);
      return t("uncategorized");
    };

    /** Text of a property in a row (columns without their own rendering, board badges); date buckets read the view's date field. */
    const cell = (id: PropId, row: DisplayRow, dateField: "date" | "effectiveDate" = "date"): string => {
      const bucket = bucketOf(id);
      if (bucket) return fmt.bucketLabel(bucket, bucketKeyOf(row[dateField] || row.date, bucket));
      switch (id) {
        case "date":
          return fmt.date(row.date);
        case "description":
          return row.description;
        case "entityId":
          return rowEntity(row);
        case "accountId":
          return rowAccount(row);
        case "categoryId":
          return rowCategory(row);
        case "flowKind":
          return t(`flowKind.${row.flowKind}`);
        case "currency":
          return row.currency;
        case "isRecurring":
          return yesNo(row.isRecurring);
        case "isTaxDeductible":
          return yesNo(row.isTaxDeductible);
        case "amountBase":
          return fmt.money(row.displayAmount);
        default:
          return "";
      }
    };

    /** Name of a filter's field, for chips the property list does not cover. */
    const fieldName = (field: string) => (isPropId(field) ? prop(field) : t(`filters.fields.${field}`));

    /** A chip's text: "Entidade é PF, Kodama LTDA", "Mês é 3 valores", "Tipo: escolha…". */
    const filterLabel = (filter: LedgerFilter | null, propId?: PropId): string => {
      const id = propId ?? (filter ? filterProp(filter) : null);
      if (id) {
        const labels = filter ? filterValues(filter).map((v) => value(id, v)) : [];
        const text = chipText(labels);
        const name = prop(id);
        if (text.kind === "choose") return t("filters.choose", { prop: name });
        if (text.kind === "count") return t("filters.count", { prop: name, count: text.count });
        return t("filters.values", { prop: name, values: text.values.join(", ") });
      }
      if (!filter) return "";
      // The import's own view reads like its name: "Importação · nubank-fatura-2026-09".
      if (filter.field === "importId" && filter.op === "in" && filter.values.length === 1) {
        const file = imports.get(String(filter.values[0]));
        return file ? t("filters.import", { file }) : fieldName(filter.field);
      }
      const name = fieldName(filter.field);
      switch (filter.op) {
        case "in":
        case "nin": {
          const labels = filter.values.map((v) => value(filter.field, v === null ? null : String(v)));
          if (filter.op === "in") return labels.length <= 2 ? t("filters.values", { prop: name, values: labels.join(", ") }) : t("filters.count", { prop: name, count: labels.length });
          return labels.length <= 2 ? t("filters.notIn", { prop: name, values: labels.join(", ") }) : t("filters.notInCount", { prop: name, count: labels.length });
        }
        case "inBuckets":
          return t("filters.values", { prop: name, values: filter.values.map((v) => fmt.bucketLabel(filter.bucket, v)).join(", ") });
        case "isNull":
          return t("filters.isNull", { prop: name });
        case "isNotNull":
          return t("filters.isNotNull", { prop: name });
        case "contains":
          return t("filters.values", { prop: name, values: `“${filter.value}”` });
        case "asOf":
          return t("filters.spentAsOf", { date: fmt.date(filter.asOf) });
        default:
          return t("filters.other", { prop: name });
      }
    };

    /** The range a view covers: "set/2026", "jul/2026 – set/2026", "todo o período". */
    const rangeText = (period: Period, range: { from: string | null; to: string | null } | null | undefined): string => {
      if (presetOf(period) === "all" || !range?.from || !range.to) {
        if ("from" in period) return fmt.periodRangeLabel(period.from, period.to);
        return t("period.whole");
      }
      return fmt.periodRangeLabel(range.from, range.to);
    };

    return { prop, value, groupValue, cell, rowEntity, rowAccount, rowCategory, filterLabel, rangeText, yesNo };
  }, [t, fmt, names, imports]);
}

export type LedgerLabels = ReturnType<typeof useLedgerLabels>;
