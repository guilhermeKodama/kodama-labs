import type { DbClient } from "@capital/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import { st } from "@capital/server/i18n";
import { loadUserLocale } from "@capital/server/i18n/user-locale";
import {
  aggregationKey,
  ledgerQuerySchema,
  type Aggregation,
  type CategoricalField,
  type DateField,
  type GroupKey,
  type LedgerDisplayQueryResult,
  type LedgerDisplayRow,
  type LedgerFilter,
  type LedgerGroup,
  type LedgerQuery,
  type LedgerQueryInput,
  type LedgerQueryResult,
  type LedgerRow,
  type LedgerSelectionQuery,
  type LedgerSummary,
  type NumericField,
  type Period,
  type TimeBucket,
} from "../contracts";
import { FLOW_CATEGORY_KEYS, isFlowCategoryKey, type FlowCategoryKey } from "@/lib/ledger/flow-category";
import { LedgerError } from "../lib/errors";
import { flowKindJoins, flowKindSql, type FlowKind } from "../lib/flow-sql";
import { spentToDateSql } from "../lib/spend-as-of";
import { toNumber } from "../lib/money";

/*
 * The ledger query engine. Every query selects ledger entries with one
 * WHERE (period, filters, search) and then reads them in one of two ways:
 *
 * - legs: one row per entry (MCP, the assistant, the trash).
 * - display: what the UI shows, one row per entry or per transfer (see
 *   ledgerQuerySchema.semantics). `counts`, `display_amount` and `neutral`
 *   follow the table below, and every count, sum, group, pivot cell and
 *   page is over these rows, so a page never splits a transfer.
 *
 *   | Case                                        | counts | display_amount    |
 *   | transfer, both legs selected                | no     | |amount| (⇄)      |
 *   | transfer, one leg selected (entity filter)  | yes    | signed            |
 *   | investment_deposit / investment_withdrawal  | yes    | − into the broker |
 *   | broker buy/sell/... cash leg                | no     | signed            |
 *   | dividend / yield cash leg, everything else  | yes    | signed            |
 *
 * Both modes build the same CTE chain (sel → dr → src), so they share
 * column names: legs mode is display mode where every row counts and
 * stands alone. Sums (sum/avg/median/min/max and group sums) read counted
 * rows only; count and countDistinct read every row.
 */

// ---------------------------------------------------------------------------
// Selection: raw table expressions (WHERE level)
// ---------------------------------------------------------------------------

const RAW_CATEGORICAL: Record<CategoricalField, Prisma.Sql> = {
  entityId: Prisma.sql`le."entityId"`,
  entityKind: Prisma.sql`e.kind::text`,
  accountId: Prisma.sql`le."accountId"`,
  accountType: Prisma.sql`a.type::text`,
  categoryId: Prisma.sql`le."categoryId"`,
  kind: Prisma.sql`le.kind::text`,
  flowKind: flowKindSql(),
  currency: Prisma.sql`le.currency`,
  isTaxDeductible: Prisma.sql`le."isTaxDeductible"`,
  isRecurring: Prisma.sql`(le."recurringRuleId" IS NOT NULL)`,
  transferDirection: Prisma.sql`tg.direction::text`,
  cardStatementId: Prisma.sql`le."cardStatementId"`,
  importId: Prisma.sql`le."importId"`,
  id: Prisma.sql`le.id`,
  transferGroupId: Prisma.sql`le."transferGroupId"`,
  recurringRuleId: Prisma.sql`le."recurringRuleId"`,
  installmentPlanId: Prisma.sql`le."installmentPlanId"`,
};
const BOOLEAN_FIELDS = new Set<string>(["isTaxDeductible", "isRecurring"]);

const RAW_NUMERIC: Record<NumericField, Prisma.Sql> = {
  amount: Prisma.sql`le.amount`,
  amountBase: Prisma.sql`le."amountBase"`,
};

const RAW_DATE: Record<DateField, Prisma.Sql> = {
  date: Prisma.sql`le.date`,
  effectiveDate: Prisma.sql`le."effectiveDate"`,
};

const FROM = Prisma.sql`
  FROM ledger_entries le
  JOIN accounts a ON a.id = le."accountId"
  JOIN entities e ON e.id = le."entityId"
  LEFT JOIN categories c ON c.id = le."categoryId"
  ${flowKindJoins()}`;

/** Key of a date bucket, as text (see TIME_BUCKETS). */
function bucketSql(bucket: TimeBucket, col: Prisma.Sql): Prisma.Sql {
  switch (bucket) {
    case "day":
      return Prisma.sql`to_char(${col}, 'YYYY-MM-DD')`;
    case "week":
      return Prisma.sql`to_char(date_trunc('week', ${col}), 'YYYY-MM-DD')`;
    case "monthWeek":
      return Prisma.sql`(to_char(${col}, 'YYYY-MM') || '-W' || ((extract(day from ${col})::int + 6) / 7)::text)`;
    case "month":
      return Prisma.sql`to_char(${col}, 'YYYY-MM')`;
    case "quarter":
      return Prisma.sql`to_char(${col}, 'YYYY-"Q"Q')`;
    case "year":
      return Prisma.sql`to_char(${col}, 'YYYY')`;
  }
}

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
      // "Este ano" runs from January to the current month; a past year is the whole year.
      return off === 0 ? { from: monthStart(y, 0), to: monthEnd(y, m0) } : { from: monthStart(y + off, 0), to: monthEnd(y + off, 11) };
    case "last_12m":
      return { from: monthStart(y, m0 - 11 + off * 12), to: monthEnd(y, m0 + off * 12) };
  }
}

// ---------------------------------------------------------------------------
// WHERE
// ---------------------------------------------------------------------------

const flowOfCategoryKey = (key: FlowCategoryKey): FlowKind => (key === FLOW_CATEGORY_KEYS.invest ? "invest" : "transfer");

/**
 * In display mode a categoryId `in`/`nin` value set matches like the
 * categoryId group keys: null is "Sem categoria" (empty category, neither
 * an aporte nor a transfer) and FLOW_CATEGORY_KEYS select the
 * uncategorized aportes and transfers. `isNull` matches every empty
 * category, and legs mode (MCP, assistant) keeps null as any empty one.
 */
function filterSql(f: LedgerFilter, display: boolean): Prisma.Sql {
  switch (f.op) {
    case "in":
    case "nin": {
      const col = RAW_CATEGORICAL[f.field];
      const isCategory = display && f.field === "categoryId";
      const flowKeys = isCategory ? f.values.filter(isFlowCategoryKey) : [];
      const nonNull = f.values.filter((v) => v !== null && !flowKeys.includes(v as FlowCategoryKey));
      const hasNull = f.values.includes(null);
      const values = BOOLEAN_FIELDS.has(f.field) ? nonNull.map((v) => v === true || v === "true") : nonNull.map(String);
      const parts: Prisma.Sql[] = [];
      if (values.length) parts.push(Prisma.sql`${col} IN (${Prisma.join(values)})`);
      if (hasNull) parts.push(isCategory ? Prisma.sql`(${col} IS NULL AND ${flowKindSql()} NOT IN ('invest', 'transfer'))` : Prisma.sql`${col} IS NULL`);
      for (const key of flowKeys) parts.push(Prisma.sql`(${col} IS NULL AND ${flowKindSql()} = ${flowOfCategoryKey(key)})`);
      const inner = parts.length > 1 ? Prisma.sql`(${Prisma.join(parts, " OR ")})` : parts[0];
      return f.op === "in" ? inner : Prisma.sql`NOT coalesce(${inner}, false)`;
    }
    case "isNull":
      return Prisma.sql`${RAW_CATEGORICAL[f.field]} IS NULL`;
    case "isNotNull":
      return Prisma.sql`${RAW_CATEGORICAL[f.field]} IS NOT NULL`;
    case "gt":
      return Prisma.sql`${RAW_NUMERIC[f.field]} > ${f.value}`;
    case "gte":
      return Prisma.sql`${RAW_NUMERIC[f.field]} >= ${f.value}`;
    case "lt":
      return Prisma.sql`${RAW_NUMERIC[f.field]} < ${f.value}`;
    case "lte":
      return Prisma.sql`${RAW_NUMERIC[f.field]} <= ${f.value}`;
    case "eq":
      return Prisma.sql`${RAW_NUMERIC[f.field]} = ${f.value}`;
    case "between":
      if ("min" in f) return Prisma.sql`${RAW_NUMERIC[f.field]} BETWEEN ${f.min} AND ${f.max}`;
      return Prisma.sql`${RAW_DATE[f.field]} BETWEEN ${new Date(`${f.from}T00:00:00.000Z`)} AND ${new Date(`${f.to}T23:59:59.999Z`)}`;
    case "contains":
      return Prisma.sql`le.description ILIKE ${likePattern(f.value)}`;
    case "inBuckets":
      return Prisma.sql`${bucketSql(f.bucket, RAW_DATE[f.field])} IN (${Prisma.join(f.values)})`;
    case "asOf":
      return spentToDateSql("le", new Date(`${f.asOf}T23:59:59.999Z`));
  }
}

/** ILIKE pattern for a substring, with the wildcards in it escaped. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

/**
 * Search over the description, notes, merchant and the category, account
 * and entity names. A transfer leg also matches by its other leg's account
 * and entity, so a search never splits a transfer.
 */
function searchSql(search: string): Prisma.Sql {
  const like = likePattern(search);
  return Prisma.sql`(le.description ILIKE ${like} OR le.notes ILIKE ${like} OR le."merchantName" ILIKE ${like}
    OR c.name ILIKE ${like} OR a.name ILIKE ${like} OR e.name ILIKE ${like}
    OR (le."transferGroupId" IS NOT NULL AND EXISTS (
      SELECT 1 FROM ledger_entries o
      JOIN accounts oa ON oa.id = o."accountId"
      JOIN entities oe ON oe.id = o."entityId"
      WHERE o."transferGroupId" = le."transferGroupId" AND o.id <> le.id AND (oa.name ILIKE ${like} OR oe.name ILIKE ${like}))))`;
}

/** WHERE of a selection; `semantics` sets how categoryId filters read (see filterSql). */
export function buildWhere(
  userId: string,
  q: LedgerSelectionQuery,
  timezone: string,
  semantics: LedgerQuery["semantics"] = "legs"
): { sql: Prisma.Sql; range: { from: Date | null; to: Date | null } } {
  const parts: Prisma.Sql[] = [Prisma.sql`le."userId" = ${userId}`];
  if (q.deleted === "exclude") parts.push(Prisma.sql`le."deletedAt" IS NULL`);
  if (q.deleted === "only") parts.push(Prisma.sql`le."deletedAt" IS NOT NULL`);
  const range = resolvePeriod(q.period, timezone);
  const dateCol = RAW_DATE[q.dateField];
  if (range.from) parts.push(Prisma.sql`${dateCol} >= ${range.from}`);
  if (range.to) parts.push(Prisma.sql`${dateCol} <= ${range.to}`);
  for (const f of q.filters) parts.push(filterSql(f, semantics === "display"));
  if (q.search) parts.push(searchSql(q.search));
  return { sql: Prisma.sql`WHERE ${Prisma.join(parts, " AND ")}`, range };
}

// ---------------------------------------------------------------------------
// Source rows: sel (selected legs) → dr (rows of the mode) → src (scope)
// ---------------------------------------------------------------------------

const SEL_COLUMNS = Prisma.sql`
  le.id AS "id", le.date AS "date", le."effectiveDate" AS "effectiveDate", le.description AS "description", le.notes AS "notes",
  le.kind::text AS "kind", le.amount AS "amount", le.currency AS "currency", le."exchangeRate" AS "exchangeRate",
  le."amountBase" AS "amountBase", le."entityId" AS "entityId", e.kind::text AS "entityKind", le."accountId" AS "accountId", a.type::text AS "accountType",
  le."categoryId" AS "categoryId", le."isTaxDeductible" AS "isTaxDeductible", (le."recurringRuleId" IS NOT NULL) AS "isRecurring",
  tg.direction::text AS "transferDirection", le."cardStatementId" AS "cardStatementId", le."importId" AS "importId",
  ${flowKindSql()} AS "flowKind", le."transferGroupId" AS "transferGroupId", le."recurringRuleId" AS "recurringRuleId",
  le."installmentPlanId" AS "installmentPlanId", le."installmentNumber" AS "installmentNumber", le."deletedAt" AS "deletedAt",
  le."createdAt" AS "createdAt", io.id AS op_id, io.type::text AS op_type`;

/** The transfer's other leg (r is the row's alias). */
const COUNTERPART = Prisma.sql`LEFT JOIN LATERAL (
    SELECT o."accountId", o."entityId" FROM ledger_entries o
    WHERE o."transferGroupId" = r."transferGroupId" AND o.id <> r.id
    ORDER BY o."deletedAt" NULLS FIRST, o.id LIMIT 1) cp ON true`;

const INVEST_DIRECTIONS = Prisma.sql`('investment_deposit', 'investment_withdrawal')`;
const INCOME_OPERATIONS = Prisma.sql`('dividend', 'yield_payment')`;

/** `WITH sel, dr, src`: src holds the rows every read of a query works on. */
function sourceCte(where: Prisma.Sql, q: Pick<LedgerQuery, "semantics" | "rowsScope">): Prisma.Sql {
  const scope = q.rowsScope === "counted" ? Prisma.sql`WHERE dr.counts` : Prisma.empty;
  if (q.semantics === "legs") {
    return Prisma.sql`WITH sel AS (SELECT ${SEL_COLUMNS} ${FROM} ${where}),
      dr AS (
        SELECT r.*, ARRAY[r.id] AS leg_ids, cp."accountId" AS cp_account, cp."entityId" AS cp_entity,
          true AS counts, false AS neutral, r."amountBase" AS display_amount, r.amount AS display_amount_orig
        FROM sel r ${COUNTERPART}),
      src AS (SELECT * FROM dr ${scope})`;
  }
  // One row per transfer: the outflow leg stands for the pair, never the broker leg.
  return Prisma.sql`WITH sel AS MATERIALIZED (SELECT ${SEL_COLUMNS} ${FROM} ${where}),
    ranked AS (
      SELECT s.*,
        count(*) OVER (PARTITION BY coalesce(s."transferGroupId", s.id)) AS legs_in_sel,
        row_number() OVER pair AS rn,
        array_agg(s.id) OVER (pair ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING) AS leg_ids
      FROM sel s
      WINDOW pair AS (PARTITION BY coalesce(s."transferGroupId", s.id) ORDER BY (s."accountType" = 'brokerage'), s.amount, s.id)),
    dr AS (
      SELECT r.*, cp."accountId" AS cp_account, cp."entityId" AS cp_entity,
        (CASE
          WHEN r."transferDirection" IN ${INVEST_DIRECTIONS} THEN true
          WHEN r."transferGroupId" IS NOT NULL THEN r.legs_in_sel = 1
          WHEN r.kind = 'investment' THEN
            CASE WHEN r.op_type IS NULL THEN r."accountType" <> 'brokerage' ELSE r.op_type IN ${INCOME_OPERATIONS} END
          ELSE true END) AS counts,
        (r."transferGroupId" IS NOT NULL AND r.legs_in_sel > 1 AND r."transferDirection" NOT IN ${INVEST_DIRECTIONS}) AS neutral,
        (CASE
          WHEN r."transferDirection" IN ${INVEST_DIRECTIONS} THEN CASE WHEN r."accountType" = 'brokerage' THEN -r."amountBase" ELSE r."amountBase" END
          WHEN r."transferGroupId" IS NOT NULL AND r.legs_in_sel > 1 THEN abs(r."amountBase")
          ELSE r."amountBase" END) AS display_amount,
        (CASE
          WHEN r."transferDirection" IN ${INVEST_DIRECTIONS} THEN CASE WHEN r."accountType" = 'brokerage' THEN -r.amount ELSE r.amount END
          WHEN r."transferGroupId" IS NOT NULL AND r.legs_in_sel > 1 THEN abs(r.amount)
          ELSE r.amount END) AS display_amount_orig
      FROM ranked r ${COUNTERPART}
      WHERE r.rn = 1),
    src AS (SELECT * FROM dr ${scope})`;
}

// ---------------------------------------------------------------------------
// Expressions over source rows
// ---------------------------------------------------------------------------

const ident = (alias: string, column: string) => Prisma.raw(`${alias}."${column}"`);

function numericExpr(field: NumericField, alias: string): Prisma.Sql {
  return Prisma.raw(field === "amountBase" ? `${alias}.display_amount` : `${alias}.display_amount_orig`);
}

// Inlined (not bound): the key expression repeats in SELECT and GROUP BY.
const FLOW_KEY_SQL = { invest: Prisma.raw(`'${FLOW_CATEGORY_KEYS.invest}'`), transfer: Prisma.raw(`'${FLOW_CATEGORY_KEYS.transfer}'`) };

/** A row's key for a group key. Neutral transfers between entities (any neutral transfer, by account) key as "from→to". */
function groupKeyExpr(g: GroupKey, alias: string): Prisma.Sql {
  if ("bucket" in g) return bucketSql(g.bucket, ident(alias, g.field));
  const x = Prisma.raw(alias);
  if (g.field === "categoryId") {
    // Uncategorized aportes and counted transfers group as Investimentos / Transferência (FLOW_CATEGORY_KEYS).
    return Prisma.sql`(CASE WHEN ${x}."categoryId" IS NULL AND ${x}."flowKind" IN ('invest', 'transfer') THEN (CASE ${x}."flowKind" WHEN 'invest' THEN ${FLOW_KEY_SQL.invest} ELSE ${FLOW_KEY_SQL.transfer} END) ELSE ${x}."categoryId" END)`;
  }
  if (g.field === "entityId") {
    return Prisma.sql`(CASE WHEN ${x}.neutral AND ${x}.cp_entity IS NOT NULL AND ${x}.cp_entity <> ${x}."entityId" THEN ${x}."entityId" || '→' || ${x}.cp_entity ELSE ${x}."entityId" END)`;
  }
  if (g.field === "accountId") {
    return Prisma.sql`(CASE WHEN ${x}.neutral AND ${x}.cp_account IS NOT NULL THEN ${x}."accountId" || '→' || ${x}.cp_account ELSE ${x}."accountId" END)`;
  }
  return BOOLEAN_FIELDS.has(g.field) ? Prisma.sql`(${ident(alias, g.field)})::text` : ident(alias, g.field);
}

const NUMERIC_ONLY = new Set(["sum", "avg", "median", "min", "max"]);
const isNumericField = (field: string): field is NumericField => field === "amount" || field === "amountBase";
const isDateField = (field: string): field is DateField => field === "date" || field === "effectiveDate";

function aggSql(agg: Aggregation, display: boolean, alias = "src"): Prisma.Sql {
  if (NUMERIC_ONLY.has(agg.fn) && !isNumericField(agg.field)) {
    throw new LedgerError(`${agg.fn} needs a numeric field, got ${agg.field}`, 422, { code: "query.aggregation_needs_numeric", params: { fn: agg.fn, field: agg.field } });
  }
  if (agg.bucket && !(agg.fn === "countDistinct" && isDateField(agg.field))) {
    const field = `${agg.field}:${agg.bucket}`;
    throw new LedgerError(`Unknown aggregation field ${field}`, 422, { code: "query.unknown_aggregation_field", params: { field } });
  }
  const counted = Prisma.raw(`FILTER (WHERE ${alias}.counts)`);
  const field = agg.field;
  switch (agg.fn) {
    case "sum":
      return Prisma.sql`coalesce(sum(${numericExpr(field as NumericField, alias)}) ${counted}, 0)`;
    case "avg":
      return Prisma.sql`avg(${numericExpr(field as NumericField, alias)}) ${counted}`;
    case "median":
      return Prisma.sql`percentile_cont(0.5) WITHIN GROUP (ORDER BY ${numericExpr(field as NumericField, alias)}) ${counted}`;
    case "min":
      return Prisma.sql`min(${numericExpr(field as NumericField, alias)}) ${counted}`;
    case "max":
      return Prisma.sql`max(${numericExpr(field as NumericField, alias)}) ${counted}`;
    case "count":
      return Prisma.sql`count(*)`;
    case "countDistinct":
      if (isNumericField(field)) return Prisma.sql`count(DISTINCT ${numericExpr(field, alias)})`;
      if (isDateField(field)) return Prisma.sql`count(DISTINCT ${agg.bucket ? bucketSql(agg.bucket, ident(alias, field)) : ident(alias, field)})`;
      // Display mode counts what the table shows (mockup unique): every group value, "Sem categoria" and
      // "from→to" transfers included, the same keys as the groups.
      if (display && field !== "description") return Prisma.sql`count(DISTINCT coalesce((${groupKeyExpr({ field }, alias)})::text, ''))`;
      return Prisma.sql`count(DISTINCT ${ident(alias, field)})`;
  }
}

function aggSelect(aggs: Aggregation[], display: boolean): Prisma.Sql {
  if (!aggs.length) return Prisma.sql`NULL AS "a_none"`;
  return Prisma.join(aggs.map((a, i) => Prisma.sql`${aggSql(a, display)} AS ${Prisma.raw(`"a${i}"`)}`), ", ");
}

function readAggs(row: Record<string, unknown>, aggs: Aggregation[]): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  aggs.forEach((a, i) => {
    const v = row[`a${i}`];
    out[aggregationKey(a)] = v === null || v === undefined ? null : toNumber(v as Prisma.Decimal | number);
  });
  return out;
}

const COUNTED_SUM = Prisma.sql`coalesce(sum(src.display_amount) FILTER (WHERE src.counts), 0)`;

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

const isTimeKey = (g: GroupKey) => "bucket" in g;

/** Byte order with nulls last (SQL: COLLATE "C" ASC NULLS LAST). */
function compareKeys(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

/** Group order: time buckets ascending; other keys by |counted sum| descending, then key. Rows follow the same order. */
function compareGroups(key: GroupKey, a: { key: string | null; weight: number }, b: { key: string | null; weight: number }): number {
  if (isTimeKey(key)) return compareKeys(a.key, b.key);
  return b.weight - a.weight || compareKeys(a.key, b.key);
}

interface RawGroup {
  keys: (string | null)[];
  count: number;
  values: Record<string, number | null>;
  /** |counted sum|, the sort weight. */
  weight: number;
}

async function groupQuery(db: DbClient, cte: Prisma.Sql, keys: GroupKey[], aggs: Aggregation[], display: boolean): Promise<RawGroup[]> {
  const keySql = keys.map((k, i) => Prisma.sql`${groupKeyExpr(k, "src")} AS ${Prisma.raw(`"k${i}"`)}`);
  const groupBy = Prisma.join(keys.map((_, i) => Prisma.raw(`"k${i}"`)), ", ");
  const rows = await db.$queryRaw<Record<string, unknown>[]>`
    ${cte}
    SELECT ${Prisma.join(keySql, ", ")}, count(*)::int AS n, ${aggSelect(aggs, display)}, ${COUNTED_SUM} AS weight
    FROM src
    GROUP BY ${groupBy}`;
  return rows.map((r) => ({
    keys: keys.map((_, i) => (r[`k${i}`] as string | null) ?? null),
    count: Number(r.n),
    values: readAggs(r, aggs),
    weight: Math.abs(toNumber(r.weight as Prisma.Decimal)),
  }));
}

async function buildGroups(db: DbClient, cte: Prisma.Sql, groupBy: GroupKey[], aggs: Aggregation[], display: boolean): Promise<LedgerGroup[]> {
  const top = (await groupQuery(db, cte, [groupBy[0]], aggs, display))
    .map((g) => ({ key: g.keys[0], count: g.count, values: g.values, weight: g.weight }))
    .sort((a, b) => compareGroups(groupBy[0], a, b));
  const groups: LedgerGroup[] = top.map((g) => ({ key: g.key, count: g.count, values: g.values }));
  if (groupBy.length === 2) {
    const nested = await groupQuery(db, cte, groupBy, aggs, display);
    for (const g of groups) {
      g.children = nested
        .filter((n) => n.keys[0] === g.key)
        .map((n) => ({ key: n.keys[1], count: n.count, values: n.values, weight: n.weight }))
        .sort((a, b) => compareGroups(groupBy[1], a, b))
        .map(({ key, count, values }) => ({ key, count, values }));
    }
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function sortExpr(field: LedgerQuery["sort"][number]["field"], alias: string): Prisma.Sql {
  switch (field) {
    case "amount":
      return Prisma.raw(`${alias}.display_amount_orig`);
    case "amountBase":
      return Prisma.raw(`${alias}.display_amount`);
    case "absAmountBase":
      return Prisma.raw(`abs(${alias}.display_amount)`);
    default:
      return ident(alias, field);
  }
}

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
  cardStatementId: string | null;
  installmentPlanId: string | null;
  installmentNumber: number | null;
  importId: string | null;
  deletedAt: Date | null;
  flowKind: FlowKind;
  op_id: string | null;
  op_type: string | null;
  leg_ids: string[];
  cp_account: string | null;
  cp_entity: string | null;
  counts: boolean;
  neutral: boolean;
  display_amount: Prisma.Decimal;
  installment_total?: number | null;
  funded_op_id?: string | null;
  funded_op_type?: string | null;
  attachment_count?: number;
  [groupKey: `gk${number}`]: string | null;
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
    counterpartAccountId: r.cp_account,
    cardStatementId: r.cardStatementId,
    installmentPlanId: r.installmentPlanId,
    installmentNumber: r.installmentNumber,
    recurringRuleId: r.recurringRuleId,
    importId: r.importId,
    deletedAt: r.deletedAt?.toISOString() ?? null,
  };
}

function toDisplayRow(r: RawRow, groupCount: number): LedgerDisplayRow {
  return {
    ...toRow(r),
    legIds: r.leg_ids,
    flowKind: r.flowKind,
    counts: r.counts,
    displayAmount: toNumber(r.display_amount),
    neutral: r.neutral,
    counterpartEntityId: r.cp_entity,
    installmentTotal: r.installment_total ?? null,
    linkedOperationId: r.op_id ?? r.funded_op_id ?? null,
    operationType: r.op_type ?? r.funded_op_type ?? null,
    attachmentCount: r.attachment_count ?? 0,
    ...(groupCount > 0 && { groupKeys: Array.from({ length: groupCount }, (_, i) => r[`gk${i}`] ?? null) }),
  };
}

/** One page of rows. Grouped, rows come in the order of `groups` (each level), then by `sort`. */
async function fetchRows(db: DbClient, cte: Prisma.Sql, q: LedgerQuery) {
  const offset = decodeCursor(q.page.cursor);
  const display = q.semantics === "display";
  const keys = q.groupBy;

  // g adds each row's group keys; w the |counted sum| of its group at each level, the group order.
  const keyCols = keys.map((k, i) => Prisma.sql`${groupKeyExpr(k, "src")} AS ${Prisma.raw(`gk${i}`)}`);
  const weightCols = keys.map((_, i) => {
    const partition = Prisma.raw(keys.slice(0, i + 1).map((__, j) => `g.gk${j}`).join(", "));
    return Prisma.sql`abs(coalesce(sum(g.display_amount) FILTER (WHERE g.counts) OVER (PARTITION BY ${partition}), 0)) AS ${Prisma.raw(`w${i}`)}`;
  });
  const grouped = keys.length
    ? Prisma.sql`, g AS (SELECT src.*, ${Prisma.join(keyCols, ", ")} FROM src),
        w AS (SELECT g.*, ${Prisma.join(weightCols, ", ")} FROM g)`
    : Prisma.sql`, w AS (SELECT src.* FROM src)`;

  const groupOrder = keys.flatMap((k, i) =>
    isTimeKey(k) ? [Prisma.raw(`w.gk${i} COLLATE "C" ASC NULLS LAST`)] : [Prisma.raw(`w.w${i} DESC`), Prisma.raw(`w.gk${i} COLLATE "C" ASC NULLS LAST`)]
  );
  const order = Prisma.join(
    [...groupOrder, ...q.sort.map((s) => Prisma.sql`${sortExpr(s.field, "w")} ${Prisma.raw(s.dir === "asc" ? "ASC" : "DESC")}`), Prisma.sql`w.id ASC`],
    ", "
  );

  const extras = display
    ? Prisma.sql`, ip."totalInstallments" AS installment_total, fop.id AS funded_op_id, fop.type::text AS funded_op_type,
        (SELECT count(*)::int FROM attachments att
          WHERE att."ledgerEntryId" = ANY(w.leg_ids) OR (w."transferGroupId" IS NOT NULL AND att."transferGroupId" = w."transferGroupId")) AS attachment_count`
    : Prisma.empty;
  const extraJoins = display
    ? Prisma.sql`LEFT JOIN installment_plans ip ON ip.id = w."installmentPlanId"
        LEFT JOIN investment_operations fop ON w."transferGroupId" IS NOT NULL AND fop."fundingGroupId" = w."transferGroupId"`
    : Prisma.empty;

  const rows = await db.$queryRaw<RawRow[]>`
    ${cte} ${grouped}
    SELECT w.* ${extras}
    FROM w ${extraJoins}
    ORDER BY ${order}
    LIMIT ${q.page.limit + 1} OFFSET ${offset}`;
  const hasMore = rows.length > q.page.limit;
  const page = rows.slice(0, q.page.limit);
  return {
    rows: display ? page.map((r) => toDisplayRow(r, keys.length)) : page.map(toRow),
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

/** The mockup's totals(): aportes apart, everything else by sign, over counted rows. */
const SUMMARY_SELECT = Prisma.sql`
  coalesce(sum(src.display_amount) FILTER (WHERE src.counts AND src."flowKind" <> 'invest' AND src.display_amount > 0), 0) AS s_income,
  coalesce(-sum(src.display_amount) FILTER (WHERE src.counts AND src."flowKind" <> 'invest' AND src.display_amount < 0), 0) AS s_expense,
  coalesce(-sum(src.display_amount) FILTER (WHERE src.counts AND src."flowKind" = 'invest'), 0) AS s_investment,
  ${COUNTED_SUM} AS s_net`;

function readSummary(row: Record<string, unknown>): LedgerSummary {
  const n = (key: string) => toNumber(row[key] as Prisma.Decimal);
  return { income: n("s_income"), expense: n("s_expense"), investment: n("s_investment"), net: n("s_net"), count: Number(row.n) };
}

/**
 * Runs a ledger query. Legs mode (the default) returns one row per entry;
 * display mode (`semantics: "display"`, what the UI sends) returns display
 * rows, the KPI summary, and counts over display rows.
 */
export async function queryLedger(userId: string, input: LedgerQueryInput & { semantics: "display" }, db: DbClient): Promise<LedgerDisplayQueryResult>;
export async function queryLedger(userId: string, input: LedgerQueryInput, db: DbClient): Promise<LedgerQueryResult>;
export async function queryLedger(userId: string, input: LedgerQueryInput, db: DbClient): Promise<LedgerQueryResult | LedgerDisplayQueryResult> {
  const q = ledgerQuerySchema.parse(input);
  const display = q.semantics === "display";
  const timezone = await userTimezone(userId, db);
  const { sql: where, range } = buildWhere(userId, q, timezone, q.semantics);
  const cte = sourceCte(where, q);
  const aggs = q.aggregations;

  let totals: LedgerQueryResult["totals"] | null = null;
  let summary: LedgerSummary | null = null;
  if (!(display && q.skipTotals)) {
    const [row] = await db.$queryRaw<Record<string, unknown>[]>`
      ${cte}
      SELECT count(*)::int AS n, ${aggSelect(aggs, display)}${display ? Prisma.sql`, ${SUMMARY_SELECT}` : Prisma.empty} FROM src`;
    totals = { count: Number(row.n), values: readAggs(row, aggs) };
    if (display) summary = readSummary(row);
  }

  const groups = q.groupBy.length ? await buildGroups(db, cte, q.groupBy, aggs, display) : [];

  let pivot: LedgerQueryResult["pivot"];
  if (q.pivot) {
    const { rows: rowKey, cols: colKey } = q.pivot;
    const measure = [q.pivot.measure];
    const mk = aggregationKey(q.pivot.measure);
    const [cells, rowsAgg, colsAgg, [grand]] = await Promise.all([
      groupQuery(db, cte, [rowKey, colKey], measure, display),
      groupQuery(db, cte, [rowKey], measure, display),
      groupQuery(db, cte, [colKey], measure, display),
      db.$queryRaw<Record<string, unknown>[]>`${cte} SELECT ${aggSelect(measure, display)} FROM src`,
    ]);
    const order = (key: GroupKey) => (a: RawGroup, b: RawGroup) => compareGroups(key, { key: a.keys[0], weight: a.weight }, { key: b.keys[0], weight: b.weight });
    rowsAgg.sort(order(rowKey));
    colsAgg.sort(order(colKey));
    const rowKeys = rowsAgg.map((r) => r.keys[0]);
    const colKeys = colsAgg.map((c) => c.keys[0]);
    const cellMap = new Map(cells.map((c) => [`${c.keys[0]}\u0000${c.keys[1]}`, c.values[mk]]));
    pivot = {
      rowKeys,
      colKeys,
      cells: rowKeys.map((rk) => colKeys.map((ck) => cellMap.get(`${rk}\u0000${ck}`) ?? null)),
      rowTotals: rowsAgg.map((r) => r.values[mk]),
      colTotals: colsAgg.map((c) => c.values[mk]),
      grandTotal: readAggs(grand, measure)[mk],
    };
  }

  const page = q.includeRows ? await fetchRows(db, cte, q) : { rows: [], pageInfo: { hasMore: false, nextCursor: null } };
  const rangeOut = { from: range.from ? formatDateOnly(range.from) : null, to: range.to ? formatDateOnly(range.to) : null };

  if (display) {
    return { rows: page.rows as LedgerDisplayRow[], groups, totals, summary, ...(pivot && { pivot }), range: rangeOut, pageInfo: page.pageInfo };
  }
  return { rows: page.rows as LedgerRow[], groups, totals: totals!, ...(pivot && { pivot }), range: rangeOut, pageInfo: page.pageInfo };
}

/**
 * The display rows of a selection as a CTE whose last table is `src`, for
 * read models built on them (the cash-flow sankey). Columns: the ledger
 * entry's (camelCase), "flowKind", counts, neutral, display_amount,
 * cp_entity, cp_account, leg_ids.
 */
export async function displayRowsSource(
  userId: string,
  selection: LedgerSelectionQuery,
  db: DbClient,
  rowsScope: LedgerQuery["rowsScope"] = "all"
): Promise<{ cte: Prisma.Sql; range: { from: string | null; to: string | null } }> {
  const timezone = await userTimezone(userId, db);
  const { sql: where, range } = buildWhere(userId, selection, timezone, "display");
  return {
    cte: sourceCte(where, { semantics: "display", rowsScope }),
    range: { from: range.from ? formatDateOnly(range.from) : null, to: range.to ? formatDateOnly(range.to) : null },
  };
}

/** Ids matched by a selection query (bulk "select all in view"), capped. */
export async function selectEntryIds(userId: string, selection: LedgerSelectionQuery, db: DbClient, cap = 5000): Promise<string[]> {
  const timezone = await userTimezone(userId, db);
  const { sql: where } = buildWhere(userId, selection, timezone, "display");
  const rows = await db.$queryRaw<{ id: string }[]>`SELECT le.id ${FROM} ${where} LIMIT ${cap + 1}`;
  if (rows.length > cap) throw new LedgerError(`Selection matches more than ${cap} rows; narrow the filters`, 422, { code: "query.selection_too_large", params: { cap } });
  return rows.map((r) => r.id);
}

/** CSV export columns, in order; the header row is each one's name in the user's locale (ledger.csv.*). */
const CSV_COLUMNS = ["date", "description", "entity", "account", "category", "kind", "amount", "currency", "amountBase", "notes"] as const;

/** What to export: a selection query, or rows by id (a transfer leg brings its other leg). */
export type ExportTarget = LedgerSelectionQuery | { ids: string[] };

/**
 * CSV export, one line per leg (up to 20k), names resolved; the header and
 * the Tipo column (flowKind: Entrada, Saída, Transferência, Aporte) are in
 * the user's locale.
 */
export async function exportLedgerCsv(userId: string, target: ExportTarget, db: DbClient): Promise<string> {
  const [timezone, locale] = await Promise.all([userTimezone(userId, db), loadUserLocale(userId, db)]);
  let where: Prisma.Sql;
  if ("ids" in target) {
    const ids = Prisma.join(target.ids.length ? target.ids : [""]);
    where = Prisma.sql`WHERE le."userId" = ${userId} AND le."deletedAt" IS NULL AND (le.id IN (${ids})
      OR le."transferGroupId" IN (SELECT x."transferGroupId" FROM ledger_entries x WHERE x."userId" = ${userId} AND x.id IN (${ids}) AND x."transferGroupId" IS NOT NULL))`;
  } else {
    where = buildWhere(userId, target, timezone, "display").sql;
  }
  const rows = await db.$queryRaw<
    { date: Date; description: string; entity: string; account: string; category: string | null; flowKind: FlowKind; amount: Prisma.Decimal; currency: string; amountBase: Prisma.Decimal; notes: string | null }[]
  >`
    SELECT le.date, le.description, e.name AS entity, a.name AS account, c.name AS category, ${flowKindSql()} AS "flowKind",
           le.amount, le.currency, le."amountBase", le.notes
    ${FROM}
    ${where}
    ORDER BY le.date DESC, le.id
    LIMIT 20000`;
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // An uncategorized aporte or transfer reads Investimentos / Transferência, as in the table's Categoria.
  const csvFlowCategory = (flowKind: FlowKind) => (flowKind === "invest" || flowKind === "transfer" ? st(locale, `views.categoryFlow.${flowKind}`) : null);
  const header = CSV_COLUMNS.map((column) => esc(st(locale, `ledger.csv.${column}`)));
  const lines = rows.map((r) =>
    [formatDateOnly(r.date), r.description, r.entity, r.account, r.category ?? csvFlowCategory(r.flowKind), st(locale, `views.flowKind.${r.flowKind}`), toNumber(r.amount), r.currency, toNumber(r.amountBase), r.notes]
      .map(esc)
      .join(",")
  );
  return [header.join(","), ...lines].join("\n");
}
