import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { FLOW_CATEGORY_KEYS } from "@/lib/ledger/flow-category";
import type { LedgerFilter, LedgerQueryInput } from "../../contracts";
import { createEntry } from "../entries";
import { buildWhere, displayRowsSource, exportLedgerCsv, queryLedger, resolvePeriod, selectEntryIds } from "../query-engine";

/**
 * Filters, buckets, sorts, error paths and CSV escaping of the query engine,
 * over a small fixed ledger:
 *   PF  2026-09-02  Mercado A     -100  Groceries           tax deductible
 *   PF  2026-09-15  Mercado B     -300  Groceries
 *   PJ  2026-09-10  Figma          -50  Software
 *   PJ  2026-09-20  Invoice      +5000  Salary
 *   PF  2026-08-30  Sem categoria -999  (none)
 *   PF  2026-10-05  Outubro       -20   (none)
 *   PJ -> PF transfer "Repasse" of 2000 on 2026-09-25
 *   Card purchase "Cartao" -40 on 2026-09-03 (statement 2026-09, effective 2026-09-05)
 */
const USER = "test-user-ledger-qfilters-001";
const GHOST = "test-user-ledger-qfilters-ghost";
let f: LedgerFixture;
const all = { preset: "all" as const, offset: 0 };
const sept = { from: "2026-09-01", to: "2026-09-30" };

const run = (input: LedgerQueryInput) => queryLedger(USER, input, prisma);
const names = async (filters: LedgerFilter[], extra: Partial<LedgerQueryInput> = {}) =>
  (await run({ period: all, filters, sort: [{ field: "date", dir: "asc" }], ...extra })).rows.map((r) => r.description);

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const e = (accountId: string, amount: number, description: string, date: string, categoryId?: string, kind: "income" | "expense" = "expense", extra: Record<string, unknown> = {}) =>
    createEntry(USER, { kind, accountId, amount, description, date, categoryId, ...extra } as never, prisma, { skipRules: true });
  await e(f.pfChecking, 100, "Mercado A", "2026-09-02", f.categories.Groceries, "expense", { isTaxDeductible: true });
  await e(f.pfChecking, 300, "Mercado B", "2026-09-15", f.categories.Groceries);
  await e(f.pjChecking, 50, "Figma", "2026-09-10", f.categories.Software);
  await e(f.pjChecking, 5000, "Invoice", "2026-09-20", f.categories.Salary, "income");
  await e(f.pfChecking, 999, "Sem categoria", "2026-08-30");
  await e(f.pfChecking, 20, "Outubro", "2026-10-05");
  await e(f.card, 40, "Cartao", "2026-09-03");
  await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 2000, date: "2026-09-25", description: "Repasse" }, prisma);
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("resolvePeriod presets", () => {
  const at = (iso: string) => vi.useFakeTimers({ toFake: ["Date"], now: new Date(iso) });
  const day = (d: Date | null) => d?.toISOString();

  it("reads this and last month, shifted by the offset", () => {
    at("2026-09-15T12:00:00Z");
    expect(resolvePeriod({ preset: "this_month", offset: 0 }, "UTC")).toEqual({ from: new Date("2026-09-01T00:00:00.000Z"), to: new Date("2026-09-30T23:59:59.999Z") });
    expect(resolvePeriod({ preset: "this_month", offset: -2 }, "UTC")).toEqual({ from: new Date("2026-07-01T00:00:00.000Z"), to: new Date("2026-07-31T23:59:59.999Z") });
    expect(resolvePeriod({ preset: "last_month", offset: 0 }, "UTC")).toEqual({ from: new Date("2026-08-01T00:00:00.000Z"), to: new Date("2026-08-31T23:59:59.999Z") });
    expect(resolvePeriod({ preset: "last_month", offset: -1 }, "UTC")).toEqual({ from: new Date("2026-07-01T00:00:00.000Z"), to: new Date("2026-07-31T23:59:59.999Z") });
  });

  it("reads the last 3 and 12 months ending this month, and steps back by whole windows", () => {
    at("2026-09-15T12:00:00Z");
    expect(day(resolvePeriod({ preset: "last_3m", offset: 0 }, "UTC").from)).toBe("2026-07-01T00:00:00.000Z");
    expect(day(resolvePeriod({ preset: "last_3m", offset: 0 }, "UTC").to)).toBe("2026-09-30T23:59:59.999Z");
    expect(day(resolvePeriod({ preset: "last_3m", offset: -1 }, "UTC").from)).toBe("2026-04-01T00:00:00.000Z");
    expect(day(resolvePeriod({ preset: "last_3m", offset: -1 }, "UTC").to)).toBe("2026-06-30T23:59:59.999Z");
    expect(day(resolvePeriod({ preset: "last_12m", offset: 0 }, "UTC").from)).toBe("2025-10-01T00:00:00.000Z");
    expect(day(resolvePeriod({ preset: "last_12m", offset: -1 }, "UTC").to)).toBe("2025-09-30T23:59:59.999Z");
  });

  it("runs ytd from January to this month, and a past year whole", () => {
    at("2026-09-15T12:00:00Z");
    expect(resolvePeriod({ preset: "ytd", offset: 0 }, "UTC")).toEqual({ from: new Date("2026-01-01T00:00:00.000Z"), to: new Date("2026-09-30T23:59:59.999Z") });
    expect(resolvePeriod({ preset: "ytd", offset: -1 }, "UTC")).toEqual({ from: new Date("2025-01-01T00:00:00.000Z"), to: new Date("2025-12-31T23:59:59.999Z") });
  });

  it("takes the month from the user's timezone", () => {
    at("2026-10-01T01:00:00Z");
    expect(day(resolvePeriod({ preset: "this_month", offset: 0 }, "America/Sao_Paulo").from)).toBe("2026-09-01T00:00:00.000Z");
    expect(day(resolvePeriod({ preset: "this_month", offset: 0 }, "UTC").from)).toBe("2026-10-01T00:00:00.000Z");
    expect(resolvePeriod({ preset: "all", offset: 0 }, "UTC")).toEqual({ from: null, to: null });
  });
});

describe("filters", () => {
  it("compares an amount to a value", async () => {
    expect(await names([{ field: "amountBase", op: "gt", value: 1000 }])).toEqual(["Invoice", "Repasse"]);
    expect(await names([{ field: "amountBase", op: "gte", value: 5000 }])).toEqual(["Invoice"]);
    expect(await names([{ field: "amount", op: "lt", value: -300 }])).toEqual(["Sem categoria", "Repasse"]);
    expect(await names([{ field: "amount", op: "lte", value: -300 }])).toEqual(["Sem categoria", "Mercado B", "Repasse"]);
    expect(await names([{ field: "amountBase", op: "eq", value: -50 }])).toEqual(["Figma"]);
    expect(await names([{ field: "amountBase", op: "between", min: -120, max: -45 }])).toEqual(["Mercado A", "Figma"]);
  });

  it("selects a date range on the purchase date or on the statement's effective date", async () => {
    expect(await names([{ field: "date", op: "between", from: "2026-09-02", to: "2026-09-03" }])).toEqual(["Mercado A", "Cartao"]);
    // The card purchase of the 3rd counts on its statement's closing date, the 5th.
    expect(await names([{ field: "effectiveDate", op: "between", from: "2026-09-04", to: "2026-09-05" }])).toEqual(["Cartao"]);
    expect(await names([], { dateField: "effectiveDate", period: { from: "2026-10-01", to: "2026-10-31" } })).toEqual(["Outubro"]);
  });

  it("matches a substring of the description, escaping the LIKE wildcards", async () => {
    expect(await names([{ field: "description", op: "contains", value: "mercado" }])).toEqual(["Mercado A", "Mercado B"]);
    expect(await names([{ field: "description", op: "contains", value: "%" }])).toEqual([]);
    expect(await names([{ field: "description", op: "contains", value: "_" }])).toEqual([]);
  });

  it("tests a column for null", async () => {
    expect(await names([{ field: "categoryId", op: "isNull" }, { field: "kind", op: "in", values: ["expense"] }])).toEqual(["Sem categoria", "Cartao", "Outubro"]);
    expect(await names([{ field: "categoryId", op: "isNotNull" }])).toEqual(["Mercado A", "Figma", "Mercado B", "Invoice"]);
  });

  it("filters booleans given as booleans or as strings", async () => {
    expect(await names([{ field: "isTaxDeductible", op: "in", values: [true] }])).toEqual(["Mercado A"]);
    expect(await names([{ field: "isTaxDeductible", op: "in", values: ["true"] }])).toEqual(["Mercado A"]);
    expect((await names([{ field: "isTaxDeductible", op: "nin", values: [true] }])).length).toBe(8);
    expect(await names([{ field: "isRecurring", op: "in", values: [true] }])).toEqual([]);
  });

  it("combines values with null in an in / nin set", async () => {
    const withNull = await names([{ field: "categoryId", op: "in", values: [f.categories.Software, null] }, { field: "kind", op: "in", values: ["expense"] }]);
    expect(withNull).toEqual(["Sem categoria", "Cartao", "Figma", "Outubro"]);
    const without = await names([{ field: "categoryId", op: "nin", values: [f.categories.Groceries] }, { field: "kind", op: "in", values: ["expense", "income"] }]);
    expect(without).toEqual(["Sem categoria", "Cartao", "Figma", "Invoice", "Outubro"]);
  });

  it("filters buckets of every size, keyed as the group keys are", async () => {
    const bucket = (b: "day" | "week" | "monthWeek" | "month" | "quarter" | "year", values: string[]) => names([{ field: "date", op: "inBuckets", bucket: b, values }]);
    expect(await bucket("day", ["2026-09-10"])).toEqual(["Figma"]);
    expect(await bucket("week", ["2026-09-14"])).toEqual(["Mercado B", "Invoice"]); // Monday the 14th to Sunday the 20th
    expect(await bucket("monthWeek", ["2026-09-W1"])).toEqual(["Mercado A", "Cartao"]);
    expect(await bucket("month", ["2026-10"])).toEqual(["Outubro"]);
    expect(await bucket("quarter", ["2026-Q4"])).toEqual(["Outubro"]);
    expect((await bucket("year", ["2026"])).length).toBe(9);
    expect(await bucket("year", ["2025"])).toEqual([]);
  });

  it("counts what was spent by a day, card purchases on the day they were swiped", async () => {
    const spent = await names([{ field: "spentToDate", op: "asOf", asOf: "2026-09-04" }, { field: "kind", op: "in", values: ["expense"] }], { period: sept });
    expect(spent).toEqual(["Mercado A", "Cartao"]);
    const later = await names([{ field: "spentToDate", op: "asOf", asOf: "2026-09-10" }, { field: "kind", op: "in", values: ["expense"] }], { period: sept });
    expect(later).toEqual(["Mercado A", "Cartao", "Figma"]);
  });

  it("filters transfers and a single leg by direction, entity kind, account type and flow", async () => {
    expect((await names([{ field: "transferDirection", op: "in", values: ["profit_distribution"] }])).length).toBe(2);
    expect(await names([{ field: "entityKind", op: "in", values: ["business"] }, { field: "kind", op: "in", values: ["income"] }])).toEqual(["Invoice"]);
    expect(await names([{ field: "accountType", op: "in", values: ["credit_card"] }])).toEqual(["Cartao"]);
    expect((await names([{ field: "flowKind", op: "in", values: ["transfer"] }])).length).toBe(2);
    expect(await names([{ field: "currency", op: "nin", values: ["BRL"] }])).toEqual([]);
  });

  it("searches names, notes and merchant, escaping wildcards", async () => {
    expect(await names([], { search: "figma" })).toEqual(["Figma"]);
    expect(await names([], { search: "100%" })).toEqual([]);
    // The PJ's entries, and both legs of the transfer: the PF leg matches through its other leg's entity.
    expect(await names([], { search: "Kodama LTDA" })).toEqual(["Figma", "Invoice", "Repasse", "Repasse"]);
  });
});

describe("display-mode category filters", () => {
  const display = (filters: LedgerFilter[]) => queryLedger(USER, { period: all, filters, semantics: "display", sort: [{ field: "date", dir: "asc" }] }, prisma);

  it("selects the uncategorized aportes and transfers by their flow keys, and Sem categoria by null", async () => {
    const transfers = await display([{ field: "categoryId", op: "in", values: [FLOW_CATEGORY_KEYS.transfer] }]);
    expect(transfers.rows).toHaveLength(1);
    expect(transfers.rows[0].neutral).toBe(true);
    const uncategorized = await display([{ field: "categoryId", op: "in", values: [null] }, { field: "kind", op: "in", values: ["expense"] }]);
    expect(uncategorized.rows.map((r) => r.description)).toEqual(["Sem categoria", "Cartao", "Outubro"]);
    const mixed = await display([{ field: "categoryId", op: "in", values: [f.categories.Software, FLOW_CATEGORY_KEYS.transfer] }]);
    expect(mixed.rows).toHaveLength(2);
    const notTransfer = await display([{ field: "categoryId", op: "nin", values: [FLOW_CATEGORY_KEYS.transfer, f.categories.Groceries] }]);
    expect(notTransfer.rows.every((r) => !r.neutral)).toBe(true);
  });

  it("groups uncategorized aportes under their flow key and the rest under their id", async () => {
    const r = await queryLedger(USER, { period: all, semantics: "display", groupBy: [{ field: "categoryId" }], includeRows: false }, prisma);
    const keys = r.groups.map((g) => g.key);
    expect(keys).toContain(FLOW_CATEGORY_KEYS.transfer);
    expect(keys).toContain(f.categories.Groceries);
    expect(keys).toContain(null);
  });
});

describe("aggregations", () => {
  it("computes sums, averages, medians and extremes over amounts", async () => {
    const r = await run({
      period: sept,
      filters: [{ field: "kind", op: "in", values: ["expense"] }],
      aggregations: [{ fn: "avg", field: "amount" }, { fn: "median", field: "amountBase" }, { fn: "min", field: "amount" }, { fn: "max", field: "amountBase" }, { fn: "countDistinct", field: "amountBase" }],
      includeRows: false,
    });
    expect(r.totals.values).toEqual({ "avg:amount": -122.5, "median:amountBase": -75, "min:amount": -300, "max:amountBase": -40, "countDistinct:amountBase": 4 });
  });

  it("reports null for an average with nothing to average", async () => {
    const r = await run({ period: { from: "2020-01-01", to: "2020-01-31" }, aggregations: [{ fn: "avg", field: "amount" }, { fn: "count", field: "id" }], includeRows: false });
    expect(r.totals.values).toEqual({ "avg:amount": null, "count:id": 0 });
  });

  it("counts distinct descriptions in display mode as the table does", async () => {
    const r = await queryLedger(USER, { period: sept, semantics: "display", aggregations: [{ fn: "countDistinct", field: "description" }, { fn: "countDistinct", field: "kind" }], includeRows: false }, prisma);
    expect(r.totals?.values["countDistinct:description"]).toBe(6);
    expect(r.totals?.values["countDistinct:kind"]).toBe(3);
  });

  it("counts distinct dates by bucket and plain distinct dates", async () => {
    const r = await run({ period: all, aggregations: [{ fn: "countDistinct", field: "date", bucket: "month" }, { fn: "countDistinct", field: "effectiveDate" }], includeRows: false });
    expect(r.totals.values["countDistinct:date:month"]).toBe(3);
    expect(r.totals.values["countDistinct:effectiveDate"]).toBe(8);
  });

  it("refuses sums of non-numeric fields and a bucket on anything but countDistinct of a date", async () => {
    await expect(run({ aggregations: [{ fn: "sum", field: "kind" }] })).rejects.toMatchObject({ status: 422, code: "query.aggregation_needs_numeric", params: { fn: "sum", field: "kind" } });
    await expect(run({ aggregations: [{ fn: "count", field: "date", bucket: "month" }] })).rejects.toMatchObject({ status: 422, code: "query.unknown_aggregation_field", params: { field: "date:month" } });
    await expect(run({ aggregations: [{ fn: "countDistinct", field: "kind", bucket: "month" }] })).rejects.toMatchObject({ code: "query.unknown_aggregation_field" });
  });
});

describe("groups and pivot keys", () => {
  it("groups by every bucket, by booleans and by the date of the effective column", async () => {
    for (const bucket of ["day", "week", "monthWeek", "month", "quarter", "year"] as const) {
      const r = await run({ period: all, groupBy: [{ field: "effectiveDate", bucket }], includeRows: false });
      expect(r.groups.length).toBeGreaterThan(0);
      expect(r.groups.map((g) => g.key)).toEqual([...r.groups.map((g) => g.key)].sort());
    }
    const bool = await run({ period: all, groupBy: [{ field: "isTaxDeductible" }], includeRows: false });
    expect(bool.groups.map((g) => g.key).sort()).toEqual(["false", "true"]);
  });

  it("orders non-time groups by the size of their sum and breaks ties by key", async () => {
    const r = await run({ period: sept, groupBy: [{ field: "categoryId" }, { field: "kind" }], includeRows: false, aggregations: [{ fn: "sum", field: "amountBase" }] });
    const weights = r.groups.map((g) => Math.abs(g.values["sum:amountBase"] ?? 0));
    expect(weights).toEqual([...weights].sort((a, b) => b - a));
    expect(r.groups.every((g) => g.children && g.children.length > 0)).toBe(true);
  });

  it("breaks ties between groups of the same size by key, with the empty key last", async () => {
    const tied = await run({ period: { from: "2026-08-01", to: "2026-08-31" }, filters: [], groupBy: [{ field: "categoryId" }], includeRows: false });
    expect(tied.groups.map((g) => g.key)).toEqual([null]); // one uncategorized row in August
    const equal = await run({
      period: sept,
      filters: [{ field: "kind", op: "in", values: ["expense"] }],
      groupBy: [{ field: "currency" }, { field: "accountType" }],
      aggregations: [{ fn: "sum", field: "amountBase" }],
      includeRows: false,
    });
    expect(equal.groups.map((g) => g.key)).toEqual(["BRL"]);
    expect(equal.groups[0].children?.map((g) => g.key)).toEqual(["checking", "credit_card"]);
    const [a, b] = equal.groups[0].children!;
    expect(Math.abs(a.values["sum:amountBase"]!)).toBeGreaterThan(Math.abs(b.values["sum:amountBase"]!));
  });

  it("orders groups of equal weight by key and puts the group with no key after the others", async () => {
    const period = { from: "2027-03-01", to: "2027-03-31" };
    try {
      await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 7, date: "2027-03-01", description: "A", categoryId: f.categories.Groceries }, prisma, { skipRules: true });
      await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 7, date: "2027-03-02", description: "B", categoryId: f.categories.Software }, prisma, { skipRules: true });
      await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 7, date: "2027-03-03", description: "C" }, prisma, { skipRules: true });
      const r = await run({ period, groupBy: [{ field: "categoryId" }], includeRows: true, aggregations: [{ fn: "sum", field: "amountBase" }] });
      const ids = [f.categories.Groceries, f.categories.Software].sort();
      expect(r.groups.map((g) => g.key)).toEqual([...ids, null]);
      expect(r.rows).toHaveLength(3);
      expect(r.rows[2].description).toBe("C");
    } finally {
      await prisma.ledgerEntry.deleteMany({ where: { userId: USER, date: { gte: new Date("2027-01-01T00:00:00Z") } } });
    }
  });

  it("orders the rows of a time grouping by their bucket, ascending", async () => {
    const r = await run({ period: all, groupBy: [{ field: "date", bucket: "month" }], aggregations: [{ fn: "count", field: "id" }], sort: [{ field: "amountBase", dir: "asc" }] });
    expect(r.groups.map((g) => g.key)).toEqual(["2026-08", "2026-09", "2026-10"]);
    const months = r.rows.map((row) => row.date.slice(0, 7));
    expect(months).toEqual([...months].sort());
  });

  it("builds a pivot with a time axis and a category axis", async () => {
    const r = await run({ period: all, pivot: { rows: { field: "categoryId" }, cols: { field: "date", bucket: "month" }, measure: { fn: "sum", field: "amountBase" } }, includeRows: false });
    expect(r.pivot?.colKeys).toEqual(["2026-08", "2026-09", "2026-10"]);
    const groceries = r.pivot!.rowKeys.indexOf(f.categories.Groceries);
    expect(r.pivot!.cells[groceries]).toEqual([null, -400, null]);
    expect(r.pivot!.grandTotal).toBe(r.pivot!.rowTotals.reduce((a, b) => (a ?? 0) + (b ?? 0), 0));
  });
});

describe("rows: sort and cursor", () => {
  it("sorts by the stored amount, by its absolute base value and by creation", async () => {
    const byAmount = await run({ period: sept, sort: [{ field: "amount", dir: "asc" }], page: { limit: 2 } });
    expect(byAmount.rows.map((r) => r.description)).toEqual(["Repasse", "Mercado B"]);
    expect(byAmount.rows.map((r) => r.amount)).toEqual([-2000, -300]);
    const byAbs = await run({ period: sept, sort: [{ field: "absAmountBase", dir: "desc" }], page: { limit: 3 } });
    expect(byAbs.rows.map((r) => r.description)).toEqual(["Invoice", "Repasse", "Repasse"]);
    const byBase = await run({ period: sept, sort: [{ field: "amountBase", dir: "asc" }], page: { limit: 1 } });
    expect(byBase.rows[0].description).toBe("Repasse");
    const byCreated = await run({ period: all, sort: [{ field: "createdAt", dir: "asc" }], page: { limit: 1 } });
    expect(byCreated.rows[0].description).toBe("Mercado A");
  });

  it("restarts from the top for a cursor with a bad offset, and refuses one that is not a cursor", async () => {
    const encode = (o: unknown) => Buffer.from(JSON.stringify({ o })).toString("base64url");
    const first = await run({ period: all, sort: [{ field: "date", dir: "asc" }], page: { limit: 2 } });
    const negative = await run({ period: all, sort: [{ field: "date", dir: "asc" }], page: { limit: 2, cursor: encode(-5) } });
    expect(negative.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
    const fractional = await run({ period: all, sort: [{ field: "date", dir: "asc" }], page: { limit: 2, cursor: encode(1.5) } });
    expect(fractional.rows.map((r) => r.id)).toEqual(first.rows.map((r) => r.id));
    await expect(run({ period: all, page: { limit: 2, cursor: "%%%not-json" } })).rejects.toMatchObject({ status: 422, code: "query.invalid_cursor" });
    expect(first.pageInfo.nextCursor).toEqual(expect.any(String));
  });

  it("reports an unknown user", async () => {
    await expect(queryLedger(GHOST, { period: all }, prisma)).rejects.toMatchObject({ status: 404, code: "user.not_found" });
    await expect(selectEntryIds(GHOST, { period: all, dateField: "date", filters: [], deleted: "exclude" }, prisma)).rejects.toMatchObject({ code: "user.not_found" });
    await expect(displayRowsSource(GHOST, { period: all, dateField: "date", filters: [], deleted: "exclude" }, prisma)).rejects.toMatchObject({ code: "user.not_found" });
    await expect(exportLedgerCsv(GHOST, { ids: [] }, prisma)).rejects.toMatchObject({ code: "user.not_found" });
  });
});

describe("selection helpers", () => {
  const selection = { period: sept, dateField: "date" as const, filters: [] as LedgerFilter[], deleted: "exclude" as const };

  it("caps the ids a selection may return", async () => {
    const ids = await selectEntryIds(USER, selection, prisma, 100);
    expect(ids.length).toBeGreaterThan(5);
    await expect(selectEntryIds(USER, selection, prisma, 3)).rejects.toMatchObject({ status: 422, code: "query.selection_too_large", params: { cap: 3 } });
  });

  it("exposes the display rows as a CTE with the period it resolved", async () => {
    const source = await displayRowsSource(USER, selection, prisma);
    expect(source.range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    const counted = await displayRowsSource(USER, { ...selection, period: all }, prisma, "counted");
    expect(counted.range).toEqual({ from: null, to: null });
    const rows = await prisma.$queryRaw<{ n: number }[]>`${counted.cte} SELECT count(*)::int AS n FROM src`;
    const everything = await prisma.$queryRaw<{ n: number }[]>`${(await displayRowsSource(USER, { ...selection, period: all }, prisma)).cte} SELECT count(*)::int AS n FROM src`;
    expect(rows[0].n).toBe(everything[0].n - 1); // the neutral transfer is not counted
  });

  it("builds a WHERE that reads the trash and the pieces of a selection", () => {
    const { sql, range } = buildWhere(USER, { period: all, dateField: "date", filters: [], deleted: "only", search: "x" }, "UTC");
    expect(sql.sql).toContain(`"deletedAt" IS NOT NULL`);
    expect(range).toEqual({ from: null, to: null });
    const included = buildWhere(USER, { period: all, dateField: "date", filters: [], deleted: "include" }, "UTC");
    expect(included.sql.sql).not.toContain("deletedAt");
  });
});

describe("exportLedgerCsv", () => {
  it("escapes commas, quotes and line breaks, and names uncategorized flows", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 1, date: "2026-11-01", description: 'Cafe, "bom"\ne forte', notes: "a;b" }, prisma, { skipRules: true });
    const csv = await exportLedgerCsv(USER, { period: { from: "2026-11-01", to: "2026-11-30" }, dateField: "date", filters: [], deleted: "exclude" }, prisma);
    expect(csv).toContain('"Cafe, ""bom""\ne forte"');
    expect(csv).toContain('"a;b"');
    const transfers = await exportLedgerCsv(USER, { period: sept, dateField: "date", filters: [{ field: "flowKind", op: "in", values: ["transfer"] }], deleted: "exclude" }, prisma);
    const lines = transfers.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Transferência");
  });

  it("exports by id: both legs of a transfer, and nothing for an empty list", async () => {
    const transfer = await prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, transferGroupId: { not: null }, amount: { gt: 0 } } });
    const csv = await exportLedgerCsv(USER, { ids: [transfer.id] }, prisma);
    expect(csv.split("\n")).toHaveLength(3);
    const empty = await exportLedgerCsv(USER, { ids: [] }, prisma);
    expect(empty.split("\n")).toHaveLength(1);
  });

  it("labels an uncategorized aporte Investimentos in the Categoria column", async () => {
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.broker, amount: 10, date: "2026-12-01" }, prisma);
    const csv = await exportLedgerCsv(USER, { period: { from: "2026-12-01", to: "2026-12-31" }, dateField: "date", filters: [], deleted: "exclude" }, prisma);
    expect(csv).toContain("Investimentos");
  });
});
