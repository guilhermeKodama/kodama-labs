import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { st } from "@capital/server/i18n";
import { loadUserLocale } from "@capital/server/i18n/user-locale";
import {
  aggregationKey,
  ledgerQuerySchema,
  type Aggregation,
  type GroupKey,
  type LedgerFilter,
  type LedgerGroup,
  type LedgerQuery,
  type LedgerQueryInput,
  type LedgerQueryResult,
  type LedgerRow,
  type LedgerSelectionQuery,
  type Period,
} from "../contracts";
import { LedgerError } from "../lib/errors";
import { toNumber } from "../lib/money";

// ---------------------------------------------------------------------------
// Field whitelist -> SQL
// ---------------------------------------------------------------------------

const CATEGORICAL_SQL: Record<string, Prisma.Sql> = {
  entityId: Prisma.sql`le."entityId"`,
  accountId: Prisma.sql`le."accountId"`,
  accountType: Prisma.sql`a.type::text`,
  categoryId: Prisma.sql`le."categoryId"`,
  kind: Prisma.sql`le.kind::text`,
  currency: Prisma.sql`le.currency`,
  isTaxDeductible: Prisma.sql`le."isTaxDeductible"`,
  isRecurring: Prisma.sql`(le."recurringRuleId" IS NOT NULL)`,
  transferDirection: Prisma.sql`tg.direction::text`,
  cardStatementId: Prisma.sql`le."cardStatementId"`,
  importId: Prisma.sql`le."importId"`,
};
const BOOLEAN_FIELDS = new Set(["isTaxDeductible", "isRecurring"]);

const NUMERIC_SQL: Record<string, Prisma.Sql> = {
  amount: Prisma.sql`le.amount`,
  amountBase: Prisma.sql`le."amountBase"`,
};

const DATE_SQL: Record<string, Prisma.Sql> = {
  date: Prisma.sql`le.date`,
  effectiveDate: Prisma.sql`le."effectiveDate"`,
};

const FROM = Prisma.sql`
  FROM ledger_entries le
  JOIN accounts a ON a.id = le."accountId"
  LEFT JOIN transfer_groups tg ON tg.id = le."transferGroupId"`;

// ---------------------------------------------------------------------------
// Period
// ---------------------------------------------------------------------------

function todayIn(timezone: string): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(new Date())
    .reduce<Record<string, string>>((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day) };
}

const monthStart = (y: number, m0: number) => new Date(Date.UTC(y, m0, 1));
const monthEnd = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0, 23, 59, 59, 999));

/** Inclusive [from, to] bounds of a period, or nulls for "all". */
export function resolvePeriod(period: Period, timezone: string): { from: Date | null; to: Date | null } {
  if ("from" in period) {
    return { from: new Date(`${period.from}T00:00:00.000Z`), to: new Date(`${period.to}T23:59:59.999Z`) };
  }
  if (period.preset === "all") return { from: null, to: null };
  const { y, m } = todayIn(timezone);
  const m0 = m - 1;
  const off = period.offset ?? 0;
  switch (period.preset) {
    case "this_month":
      return { from: monthStart(y, m0 + off), to: monthEnd(y, m0 + off) };
    case "last_month":
      return { from: monthStart(y, m0 - 1 + off), to: monthEnd(y, m0 - 1 + off) };
    case "last_3m":
      return { from: monthStart(y, m0 - 2 + off * 3), to: monthEnd(y, m0 + off * 3) };
    case "ytd":
      return { from: monthStart(y + off, 0), to: monthEnd(y + off, 11) };
    case "last_12m":
      return { from: monthStart(y, m0 - 11 + off * 12), to: monthEnd(y, m0 + off * 12) };
  }
}

// ---------------------------------------------------------------------------
// WHERE
// ---------------------------------------------------------------------------

function filterSql(f: LedgerFilter): Prisma.Sql {
  switch (f.op) {
    case "in":
    case "nin": {
      const col = CATEGORICAL_SQL[f.field];
      const nonNull = f.values.filter((v) => v !== null);
      const hasNull = nonNull.length !== f.values.length;
      const values = BOOLEAN_FIELDS.has(f.field) ? nonNull.map((v) => v === true || v === "true") : nonNull.map(String);
      const parts: Prisma.Sql[] = [];
      if (values.length) parts.push(Prisma.sql`${col} IN (${Prisma.join(values)})`);
      if (hasNull) parts.push(Prisma.sql`${col} IS NULL`);
      const inner = parts.length > 1 ? Prisma.sql`(${Prisma.join(parts, " OR ")})` : parts[0];
      return f.op === "in" ? inner : Prisma.sql`NOT coalesce(${inner}, false)`;
    }
    case "isNull":
      return Prisma.sql`${CATEGORICAL_SQL[f.field]} IS NULL`;
    case "isNotNull":
      return Prisma.sql`${CATEGORICAL_SQL[f.field]} IS NOT NULL`;
    case "gt":
      return Prisma.sql`${NUMERIC_SQL[f.field]} > ${f.value}`;
    case "gte":
      return Prisma.sql`${NUMERIC_SQL[f.field]} >= ${f.value}`;
    case "lt":
      return Prisma.sql`${NUMERIC_SQL[f.field]} < ${f.value}`;
    case "lte":
      return Prisma.sql`${NUMERIC_SQL[f.field]} <= ${f.value}`;
    case "eq":
      return Prisma.sql`${NUMERIC_SQL[f.field]} = ${f.value}`;
    case "between":
      if ("min" in f) return Prisma.sql`${NUMERIC_SQL[f.field]} BETWEEN ${f.min} AND ${f.max}`;
      return Prisma.sql`${DATE_SQL[f.field]} BETWEEN ${new Date(`${f.from}T00:00:00.000Z`)} AND ${new Date(`${f.to}T23:59:59.999Z`)}`;
    case "contains":
      return Prisma.sql`le.description ILIKE ${"%" + f.value + "%"}`;
  }
}

export function buildWhere(userId: string, q: LedgerSelectionQuery, timezone: string): { sql: Prisma.Sql; range: { from: Date | null; to: Date | null } } {
  const parts: Prisma.Sql[] = [Prisma.sql`le."userId" = ${userId}`];
  if (q.deleted === "exclude") parts.push(Prisma.sql`le."deletedAt" IS NULL`);
  if (q.deleted === "only") parts.push(Prisma.sql`le."deletedAt" IS NOT NULL`);
  const range = resolvePeriod(q.period, timezone);
  const dateCol = DATE_SQL[q.dateField];
  if (range.from) parts.push(Prisma.sql`${dateCol} >= ${range.from}`);
  if (range.to) parts.push(Prisma.sql`${dateCol} <= ${range.to}`);
  for (const f of q.filters) parts.push(filterSql(f));
  if (q.search) {
    const like = `%${q.search}%`;
    parts.push(Prisma.sql`(le.description ILIKE ${like} OR le.notes ILIKE ${like} OR le."merchantName" ILIKE ${like})`);
  }
  return { sql: Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`, range };
}

// ---------------------------------------------------------------------------
// GROUP / AGG
// ---------------------------------------------------------------------------

function groupKeySql(g: GroupKey): Prisma.Sql {
  if ("bucket" in g) {
    const col = DATE_SQL[g.field];
    switch (g.bucket) {
      case "day":
        return Prisma.sql`to_char(${col}, 'YYYY-MM-DD')`;
      case "week":
        return Prisma.sql`to_char(date_trunc('week', ${col}), 'YYYY-MM-DD')`;
      case "month":
        return Prisma.sql`to_char(${col}, 'YYYY-MM')`;
      case "quarter":
        return Prisma.sql`to_char(${col}, 'YYYY-"Q"Q')`;
      case "year":
        return Prisma.sql`to_char(${col}, 'YYYY')`;
    }
  }
  const col = CATEGORICAL_SQL[g.field];
  return BOOLEAN_FIELDS.has(g.field) ? Prisma.sql`(${col})::text` : col;
}

function aggSql(agg: Aggregation): Prisma.Sql {
  const numeric = NUMERIC_SQL[agg.field];
  const any = numeric ?? CATEGORICAL_SQL[agg.field];
  if (!any) throw new LedgerError(`Unknown aggregation field ${agg.field}`, 422, { code: "query.unknown_aggregation_field", params: { field: agg.field } });
  if (["sum", "avg", "median", "min", "max"].includes(agg.fn) && !numeric) {
    throw new LedgerError(`${agg.fn} needs a numeric field, got ${agg.field}`, 422, { code: "query.aggregation_needs_numeric", params: { fn: agg.fn, field: agg.field } });
  }
  switch (agg.fn) {
    case "sum":
      return Prisma.sql`coalesce(sum(${numeric}), 0)`;
    case "avg":
      return Prisma.sql`avg(${numeric})`;
    case "median":
      return Prisma.sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${numeric})`;
    case "min":
      return Prisma.sql`min(${numeric})`;
    case "max":
      return Prisma.sql`max(${numeric})`;
    case "count":
      return Prisma.sql`count(*)`;
    case "countDistinct":
      return Prisma.sql`count(DISTINCT ${any})`;
  }
}

function aggSelect(aggs: Aggregation[]): Prisma.Sql {
  return Prisma.join(aggs.map((a, i) => Prisma.sql`${aggSql(a)} AS ${Prisma.raw(`"a${i}"`)}`), ", ");
}

function readAggs(row: Record<string, unknown>, aggs: Aggregation[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  aggs.forEach((a, i) => {
    const v = row[`a${i}`];
    out[aggregationKey(a)] = v === null || v === undefined ? null : toNumber(v as Prisma.Decimal | number);
  });
  return out;
}

function isTimeKey(g: GroupKey) {
  return "bucket" in g;
}

async function groupQuery(
  db: DbClient,
  where: Prisma.Sql,
  keys: GroupKey[],
  aggs: Aggregation[]
): Promise<{ keys: (string | null)[]; count: number; values: Record<string, number | null> }[]> {
  const keySql = keys.map((k, i) => Prisma.sql`${groupKeySql(k)} AS ${Prisma.raw(`"k${i}"`)}`);
  const groupBy = Prisma.join(keys.map((_, i) => Prisma.raw(`"k${i}"`)), ", ");
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT ${Prisma.join(keySql, ", ")}, count(*)::int AS n, ${aggSelect(aggs)}, coalesce(sum(le."amountBase"), 0) AS weight
    ${FROM} ${where}
    GROUP BY ${groupBy}`;
  return rows.map((r) => ({
    keys: keys.map((_, i) => (r[`k${i}`] as string | null) ?? null),
    count: Number(r.n),
    values: readAggs(r, aggs),
    weight: Math.abs(toNumber(r.weight as Prisma.Decimal)),
  })).sort((a, b) => {
    for (let i = 0; i < keys.length; i++) {
      if (a.keys[i] === b.keys[i]) continue;
      if (isTimeKey(keys[i])) return String(a.keys[i]).localeCompare(String(b.keys[i]));
      return (b as { weight: number }).weight - (a as { weight: number }).weight;
    }
    return 0;
  });
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

const SORT_SQL: Record<string, Prisma.Sql> = {
  date: Prisma.sql`le.date`,
  effectiveDate: Prisma.sql`le."effectiveDate"`,
  amount: Prisma.sql`le.amount`,
  amountBase: Prisma.sql`le."amountBase"`,
  absAmountBase: Prisma.sql`abs(le."amountBase")`,
  description: Prisma.sql`le.description`,
  createdAt: Prisma.sql`le."createdAt"`,
};

function encodeCursor(offset: number) {
  return Buffer.from(JSON.stringify({ o: offset })).toString("base64url");
}
function decodeCursor(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const { o } = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return Number.isInteger(o) && o >= 0 ? o : 0;
  } catch {
    throw new LedgerError("Invalid cursor", 422, { code: "query.invalid_cursor" });
  }
}

interface RawRow {
  id: string;
  date: Date;
  effectiveDate: Date;
  description: string;
  notes: string | null;
  kind: LedgerRow["kind"];
  amount: Prisma.Decimal;
  currency: string;
  exchangeRate: Prisma.Decimal;
  amountBase: Prisma.Decimal;
  entityId: string;
  accountId: string;
  accountType: LedgerRow["accountType"];
  categoryId: string | null;
  isTaxDeductible: boolean;
  recurringRuleId: string | null;
  transferGroupId: string | null;
  transferDirection: LedgerRow["transferDirection"];
  counterpartAccountId: string | null;
  cardStatementId: string | null;
  installmentPlanId: string | null;
  installmentNumber: number | null;
  importId: string | null;
  deletedAt: Date | null;
}

function toRow(r: RawRow): LedgerRow {
  return {
    id: r.id,
    date: formatDateOnly(r.date),
    effectiveDate: formatDateOnly(r.effectiveDate),
    description: r.description,
    notes: r.notes,
    kind: r.kind,
    amount: toNumber(r.amount),
    currency: r.currency,
    exchangeRate: toNumber(r.exchangeRate),
    amountBase: toNumber(r.amountBase),
    entityId: r.entityId,
    accountId: r.accountId,
    accountType: r.accountType,
    categoryId: r.categoryId,
    isTaxDeductible: r.isTaxDeductible,
    isRecurring: r.recurringRuleId !== null,
    transferGroupId: r.transferGroupId,
    transferDirection: r.transferDirection,
    counterpartAccountId: r.counterpartAccountId,
    cardStatementId: r.cardStatementId,
    installmentPlanId: r.installmentPlanId,
    installmentNumber: r.installmentNumber,
    recurringRuleId: r.recurringRuleId,
    importId: r.importId,
    deletedAt: r.deletedAt?.toISOString() ?? null,
  };
}

async function fetchRows(db: DbClient, where: Prisma.Sql, q: LedgerQuery) {
  const offset = decodeCursor(q.page.cursor);
  const order = Prisma.join(
    [...q.sort.map((s) => Prisma.sql`${SORT_SQL[s.field]} ${Prisma.raw(s.dir === "asc" ? "ASC" : "DESC")}`), Prisma.sql`le.id ASC`],
    ", "
  );
  const rows = await db.$queryRaw<RawRow[]>`
    SELECT le.id, le.date, le."effectiveDate", le.description, le.notes, le.kind::text AS kind, le.amount, le.currency,
           le."exchangeRate", le."amountBase", le."entityId", le."accountId", a.type::text AS "accountType", le."categoryId",
           le."isTaxDeductible", le."recurringRuleId", le."transferGroupId", tg.direction::text AS "transferDirection",
           (SELECT o."accountId" FROM ledger_entries o WHERE o."transferGroupId" = le."transferGroupId" AND o.id <> le.id LIMIT 1) AS "counterpartAccountId",
           le."cardStatementId", le."installmentPlanId", le."installmentNumber", le."importId", le."deletedAt"
    ${FROM} ${where}
    ORDER BY ${order}
    LIMIT ${q.page.limit + 1} OFFSET ${offset}`;
  const hasMore = rows.length > q.page.limit;
  return {
    rows: rows.slice(0, q.page.limit).map(toRow),
    pageInfo: { hasMore, nextCursor: hasMore ? encodeCursor(offset + q.page.limit) : null },
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

async function userTimezone(userId: string, db: DbClient) {
  const user = await db.user.findUnique({ where: { id: userId }, select: { timezone: true } });
  if (!user) throw new LedgerError("User not found", 404, { code: "user.not_found" });
  return user.timezone;
}

export async function queryLedger(userId: string, input: LedgerQueryInput, db: DbClient): Promise<LedgerQueryResult> {
  const q = ledgerQuerySchema.parse(input);
  const timezone = await userTimezone(userId, db);
  const { sql: where, range } = buildWhere(userId, q, timezone);
  const aggs = q.aggregations;

  const [totalsRow] = await db.$queryRaw<Record<string, unknown>[]>`
    SELECT count(*)::int AS n, ${aggSelect(aggs)} ${FROM} ${where}`;
  const totals = { count: Number(totalsRow.n), values: readAggs(totalsRow, aggs) };

  let groups: LedgerGroup[] = [];
  if (q.groupBy.length) {
    const top = await groupQuery(db, where, [q.groupBy[0]], aggs);
    groups = top.map((g) => ({ key: g.keys[0], count: g.count, values: g.values }));
    if (q.groupBy.length === 2) {
      const nested = await groupQuery(db, where, q.groupBy, aggs);
      for (const g of groups) {
        g.children = nested
          .filter((n) => n.keys[0] === g.key)
          .map((n) => ({ key: n.keys[1], count: n.count, values: n.values }));
      }
    }
  }

  let pivot: LedgerQueryResult["pivot"];
  if (q.pivot) {
    const measure = [q.pivot.measure];
    const mk = aggregationKey(q.pivot.measure);
    const [cells, rowsAgg, colsAgg] = await Promise.all([
      groupQuery(db, where, [q.pivot.rows, q.pivot.cols], measure),
      groupQuery(db, where, [q.pivot.rows], measure),
      groupQuery(db, where, [q.pivot.cols], measure),
    ]);
    const rowKeys = rowsAgg.map((r) => r.keys[0]);
    const colKeys = colsAgg.map((c) => c.keys[0]);
    const cellMap = new Map(cells.map((c) => [`${c.keys[0]}\u0000${c.keys[1]}`, c.values[mk]]));
    const [grand] = await db.$queryRaw<Record<string, unknown>[]>`SELECT ${aggSelect(measure)} ${FROM} ${where}`;
    pivot = {
      rowKeys,
      colKeys,
      cells: rowKeys.map((rk) => colKeys.map((ck) => cellMap.get(`${rk}\u0000${ck}`) ?? null)),
      rowTotals: rowsAgg.map((r) => r.values[mk]),
      colTotals: colsAgg.map((c) => c.values[mk]),
      grandTotal: readAggs(grand, measure)[mk],
    };
  }

  const page = q.includeRows ? await fetchRows(db, where, q) : { rows: [], pageInfo: { hasMore: false, nextCursor: null } };

  return {
    rows: page.rows,
    groups,
    totals,
    ...(pivot && { pivot }),
    range: { from: range.from ? formatDateOnly(range.from) : null, to: range.to ? formatDateOnly(range.to) : null },
    pageInfo: page.pageInfo,
  };
}

/** Ids matched by a selection query (bulk "select all in view"), capped. */
export async function selectEntryIds(userId: string, selection: LedgerSelectionQuery, db: DbClient, cap = 5000): Promise<string[]> {
  const timezone = await userTimezone(userId, db);
  const { sql: where } = buildWhere(userId, selection, timezone);
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT le.id ${FROM} ${where} LIMIT ${cap + 1}`;
  if (rows.length > cap) throw new LedgerError(`Selection matches more than ${cap} rows; narrow the filters`, 422, { code: "query.selection_too_large", params: { cap } });
  return rows.map((r) => r.id);
}

/** CSV export columns, in order; the header row is each one's name in the user's locale (ledger.csv.*). */
const CSV_COLUMNS = ["date", "description", "entity", "account", "category", "kind", "amount", "currency", "amountBase", "notes"] as const;

/** CSV export of a query (all pages, up to 20k rows) with names resolved. */
export async function exportLedgerCsv(userId: string, selection: LedgerSelectionQuery, db: DbClient): Promise<string> {
  const [timezone, locale] = await Promise.all([userTimezone(userId, db), loadUserLocale(userId, db)]);
  const { sql: where } = buildWhere(userId, selection, timezone);
  const rows = await db.$queryRaw<
    { date: Date; description: string; entity: string; account: string; category: string | null; kind: string; amount: Prisma.Decimal; currency: string; amountBase: Prisma.Decimal; notes: string | null }[]
  >`
    SELECT le.date, le.description, e.name AS entity, a.name AS account, c.name AS category, le.kind::text AS kind,
           le.amount, le.currency, le."amountBase", le.notes
    ${FROM}
    JOIN entities e ON e.id = le."entityId"
    LEFT JOIN categories c ON c.id = le."categoryId"
    ${where}
    ORDER BY le.date DESC, le.id
    LIMIT 20000`;
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = CSV_COLUMNS.map((column) => esc(st(locale, `ledger.csv.${column}`)));
  const lines = rows.map((r) =>
    [formatDateOnly(r.date), r.description, r.entity, r.account, r.category, r.kind, toNumber(r.amount), r.currency, toNumber(r.amountBase), r.notes]
      .map(esc)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}
