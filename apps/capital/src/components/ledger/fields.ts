import type { GroupKey, LedgerFilter, LedgerRow, ViewConfig } from "@capital/server/modules/ledger/contracts";
import type { Names } from "@/lib/api/catalog";
import { ACCOUNT_TYPE_LABEL, dayLabel, monthName } from "@/lib/money";

export type CategoricalField = "entityId" | "accountId" | "categoryId" | "kind" | "isTaxDeductible" | "isRecurring" | "accountType" | "currency";
export type DateBucket = "day" | "week" | "month" | "quarter" | "year";

export const FIELD_LABEL: Record<CategoricalField, string> = {
  entityId: "Entidade",
  accountId: "Conta",
  categoryId: "Categoria",
  kind: "Tipo",
  isTaxDeductible: "Dedutível IR",
  isRecurring: "Recorrente",
  accountType: "Tipo de conta",
  currency: "Moeda",
};

export const KIND_LABEL: Record<string, string> = { income: "Entrada", expense: "Saída", transfer: "Transferência", investment: "Aporte" };

export const BUCKET_LABEL: Record<DateBucket, string> = { day: "Dia", week: "Semana", month: "Mês", quarter: "Trimestre", year: "Ano" };

export const FILTERABLE: CategoricalField[] = ["entityId", "accountId", "categoryId", "kind", "isTaxDeductible", "isRecurring", "accountType", "currency"];

export const COLUMN_LABEL: Record<string, string> = {
  date: "Data",
  description: "Descrição",
  entityId: "Entidade",
  accountId: "Conta",
  categoryId: "Categoria",
  kind: "Tipo",
  isTaxDeductible: "IR",
  amountBase: "Valor",
};
export const COLUMN_ORDER = ["date", "description", "entityId", "accountId", "categoryId", "kind", "isTaxDeductible", "amountBase"];

export const PERIOD_LABEL: Record<string, string> = {
  this_month: "Este mês",
  last_month: "Mês passado",
  last_3m: "Últimos 3 meses",
  ytd: "Este ano",
  last_12m: "Últimos 12 meses",
  all: "Tudo",
};

export const SORTS: { v: string; l: string; sort: ViewConfig["sort"] }[] = [
  { v: "date_desc", l: "Data (mais recente)", sort: [{ field: "date", dir: "desc" }] },
  { v: "date_asc", l: "Data (mais antiga)", sort: [{ field: "date", dir: "asc" }] },
  { v: "abs_desc", l: "Maior valor", sort: [{ field: "absAmountBase", dir: "desc" }] },
  { v: "abs_asc", l: "Menor valor", sort: [{ field: "absAmountBase", dir: "asc" }] },
  { v: "desc_asc", l: "Descrição (A–Z)", sort: [{ field: "description", dir: "asc" }] },
];

export function sortKey(sort: ViewConfig["sort"]): string {
  const first = sort[0];
  return SORTS.find((s) => s.sort[0].field === first?.field && s.sort[0].dir === first?.dir)?.v ?? "date_desc";
}

export function groupKeyId(key: GroupKey | undefined): string {
  if (!key) return "none";
  return "bucket" in key ? `date:${key.bucket}` : key.field;
}

export function groupKeyFromId(id: string): GroupKey | null {
  if (id === "none") return null;
  if (id.startsWith("date:")) return { field: "date", bucket: id.slice(5) as DateBucket };
  return { field: id as CategoricalField };
}

export function groupLabel(id: string): string {
  if (id === "none") return "Nenhum";
  if (id.startsWith("date:")) return BUCKET_LABEL[id.slice(5) as DateBucket];
  return FIELD_LABEL[id as CategoricalField] ?? id;
}

export const GROUP_OPTIONS = ["none", "categoryId", "entityId", "accountId", "kind", "accountType", "isTaxDeductible", "isRecurring", "date:day", "date:week", "date:month", "date:quarter", "date:year"];

/** Options for a filter's value checklist, from the catalogs (not from the visible rows). */
export function fieldOptions(field: CategoricalField, names: Names): { value: string | boolean; label: string }[] {
  switch (field) {
    case "entityId":
      return names.entities.map((e) => ({ value: e.id, label: names.entity.get(e.id) ?? e.name }));
    case "accountId":
      return names.accounts.map((a) => ({ value: a.id, label: `${a.name} · ${names.entity.get(a.entityId) ?? ""}${a.archivedAt ? " (arquivada)" : ""}` }));
    case "categoryId":
      return [...names.categories]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((c) => ({ value: c.id, label: `${c.name}${c.isArchived ? " (arquivada)" : ""}` }));
    case "kind":
      return Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));
    case "accountType":
      return Object.entries(ACCOUNT_TYPE_LABEL).map(([value, label]) => ({ value, label }));
    case "isTaxDeductible":
    case "isRecurring":
      return [
        { value: true, label: "Sim" },
        { value: false, label: "Não" },
      ];
    case "currency":
      return Array.from(new Set(names.accounts.map((a) => a.currency))).map((c) => ({ value: c, label: c }));
  }
}

export function valueLabel(field: string, value: unknown, names: Names): string {
  if (value === null || value === undefined || value === "") return "—";
  switch (field) {
    case "entityId":
      return names.entity.get(String(value)) ?? "—";
    case "accountId":
      return names.account.get(String(value)) ?? "—";
    case "categoryId":
      return names.category.get(String(value)) ?? "Sem categoria";
    case "kind":
      return KIND_LABEL[String(value)] ?? String(value);
    case "accountType":
      return ACCOUNT_TYPE_LABEL[String(value)] ?? String(value);
    case "isTaxDeductible":
    case "isRecurring":
      return value === true || value === "true" ? "Sim" : "Não";
    default:
      return String(value);
  }
}

export function filterLabel(filter: LedgerFilter, names: Names): string {
  const field = filter.field;
  if (field === "amountBase") {
    const fmt = (v: number) => `R$ ${Math.abs(v).toLocaleString("pt-BR")}`;
    if (filter.op === "lte" && filter.value <= 0) return `Saídas acima de ${fmt(filter.value)}`;
    if (filter.op === "gte" && filter.value >= 0) return `Entradas acima de ${fmt(filter.value)}`;
    if (filter.op === "between" && "min" in filter) return filter.max <= 0 ? `Saídas até ${fmt(filter.min)}` : `Entradas até ${fmt(filter.max)}`;
  }
  const label = FIELD_LABEL[field as CategoricalField] ?? (field === "amountBase" ? "Valor" : field === "description" ? "Descrição" : field);
  switch (filter.op) {
    case "in":
      return `${label}: ${filter.values.map((v) => valueLabel(field, v, names)).join(", ")}`;
    case "nin":
      return `${label} não é ${filter.values.map((v) => valueLabel(field, v, names)).join(", ")}`;
    case "isNull":
      return `${label}: vazia`;
    case "isNotNull":
      return `${label}: preenchida`;
    case "contains":
      return `${label} contém “${filter.value}”`;
    case "between":
      return "from" in filter ? `${label}: ${filter.from} a ${filter.to}` : `${label}: ${filter.min} a ${filter.max}`;
    default:
      return `${label} ${({ gt: ">", gte: "≥", lt: "<", lte: "≤", eq: "=" } as Record<string, string>)[filter.op]} ${filter.value}`;
  }
}

/** Key of a row for a group, matching the server's group keys. */
export function rowGroupKey(row: LedgerRow, key: GroupKey): string | null {
  if ("bucket" in key) {
    const date = row[key.field];
    switch (key.bucket) {
      case "day":
        return date;
      case "month":
        return date.slice(0, 7);
      case "year":
        return date.slice(0, 4);
      case "quarter":
        return `${date.slice(0, 4)}-Q${Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1}`;
      case "week": {
        const d = new Date(`${date}T12:00:00Z`);
        const dow = (d.getUTCDay() + 6) % 7;
        d.setUTCDate(d.getUTCDate() - dow);
        return d.toISOString().slice(0, 10);
      }
    }
  }
  const value = row[key.field as keyof LedgerRow];
  return value === null || value === undefined ? null : String(value);
}

export function groupValueLabel(key: GroupKey, value: string | null, names: Names): string {
  if ("bucket" in key) {
    if (!value) return "—";
    if (key.bucket === "month") return `${monthName(Number(value.slice(5, 7)))}/${value.slice(0, 4)}`;
    if (key.bucket === "day" || key.bucket === "week") return `${key.bucket === "week" ? "semana de " : ""}${dayLabel(value)}`;
    return value;
  }
  return valueLabel(key.field, value, names);
}
