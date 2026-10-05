import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry, softDeleteEntries } from "../entries";
import { exportLedgerCsv, queryLedger, resolvePeriod, selectEntryIds } from "../query-engine";

const USER = "test-user-ledger-query-001";
let f: LedgerFixture;
const sept = { from: "2026-09-01", to: "2026-09-30" };
let deletedId: string;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const e = (accountId: string, amount: number, description: string, date: string, categoryId?: string, kind: "income" | "expense" = "expense") =>
    createEntry(USER, { kind, accountId, amount, description, date, categoryId }, prisma, { skipRules: true });
  await e(f.pfChecking, 100, "Mercado A", "2026-09-02", f.categories.Groceries);
  await e(f.pfChecking, 300, "Mercado B", "2026-09-15", f.categories.Groceries);
  await e(f.pjChecking, 50, "Figma", "2026-09-10", f.categories.Software);
  await e(f.pjChecking, 5000, "Invoice", "2026-09-20", f.categories.Salary, "income");
  await e(f.pfChecking, 999, "Sem categoria", "2026-08-30");
  await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 2000, date: "2026-09-25" }, prisma);
  const d = await e(f.pfChecking, 77, "Apagado", "2026-09-05", f.categories.Groceries);
  deletedId = d.entryIds[0];
  await softDeleteEntries(USER, [deletedId], prisma);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("resolvePeriod", () => {
  it("resolves explicit ranges inclusively and relative presets by month", () => {
    const r = resolvePeriod({ from: "2026-09-01", to: "2026-09-30" }, "UTC");
    expect(r.from?.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(r.to?.toISOString()).toBe("2026-09-30T23:59:59.999Z");
    const now = new Date();
    const thisMonth = resolvePeriod({ preset: "this_month", offset: 0 }, "UTC");
    expect(thisMonth.from?.getUTCMonth()).toBe(now.getUTCMonth());
    const prev = resolvePeriod({ preset: "this_month", offset: -1 }, "UTC");
    expect(prev.to!.getTime()).toBeLessThan(thisMonth.from!.getTime());
    const q = resolvePeriod({ preset: "last_3m", offset: 0 }, "UTC");
    expect((q.to!.getUTCFullYear() - q.from!.getUTCFullYear()) * 12 + q.to!.getUTCMonth() - q.from!.getUTCMonth()).toBe(2);
    expect(resolvePeriod({ preset: "all", offset: 0 }, "UTC")).toEqual({ from: null, to: null });
  });
});

describe("queryLedger", () => {
  it("filters by period and kind and returns totals", async () => {
    const r = await queryLedger(USER, { period: sept, filters: [{ field: "kind", op: "in", values: ["expense"] }] }, prisma);
    expect(r.totals.count).toBe(3);
    expect(r.totals.values["sum:amountBase"]).toBe(-450);
    expect(r.rows.map((x) => x.description)).toEqual(["Mercado B", "Figma", "Mercado A"]);
    expect(r.range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
  });

  it("supports nin with null, numeric and text filters", async () => {
    const noCategory = await queryLedger(USER, { period: { preset: "all", offset: 0 }, filters: [{ field: "categoryId", op: "isNull" }, { field: "kind", op: "nin", values: ["transfer"] }] }, prisma);
    expect(noCategory.rows.map((x) => x.description)).toEqual(["Sem categoria"]);
    const big = await queryLedger(USER, { period: sept, filters: [{ field: "amountBase", op: "lte", value: -200 }] }, prisma);
    expect(big.rows.map((x) => x.description).sort()).toEqual(["Distribuição de lucros: Conta principal → Conta principal", "Mercado B"]);
    const search = await queryLedger(USER, { period: { preset: "all", offset: 0 }, search: "merc" }, prisma);
    expect(search.totals.count).toBe(2);
    const notGroceries = await queryLedger(USER, { period: sept, filters: [{ field: "categoryId", op: "nin", values: [f.categories.Groceries, null] }] }, prisma);
    expect(notGroceries.rows.map((x) => x.description).sort()).toEqual(["Figma", "Invoice"]);
  });

  it("groups by category and by month with nested groups", async () => {
    const r = await queryLedger(
      USER,
      {
        period: { preset: "all", offset: 0 },
        filters: [{ field: "kind", op: "in", values: ["expense"] }],
        groupBy: [{ field: "date", bucket: "month" }, { field: "categoryId" }],
        includeRows: false,
      },
      prisma
    );
    expect(r.rows).toEqual([]);
    expect(r.groups.map((g) => g.key)).toEqual(["2026-08", "2026-09"]);
    const sep = r.groups[1];
    expect(sep.values["sum:amountBase"]).toBe(-450);
    expect(sep.children?.[0]).toMatchObject({ key: f.categories.Groceries, count: 2 });
    expect(sep.children?.[0].values["sum:amountBase"]).toBe(-400);
  });

  it("computes every aggregation", async () => {
    const r = await queryLedger(
      USER,
      {
        period: sept,
        filters: [{ field: "kind", op: "in", values: ["expense"] }],
        aggregations: [
          { fn: "sum", field: "amountBase" },
          { fn: "avg", field: "amountBase" },
          { fn: "median", field: "amountBase" },
          { fn: "min", field: "amountBase" },
          { fn: "max", field: "amountBase" },
          { fn: "count", field: "amountBase" },
          { fn: "countDistinct", field: "categoryId" },
        ],
        includeRows: false,
      },
      prisma
    );
    expect(r.totals.values).toEqual({
      "sum:amountBase": -450,
      "avg:amountBase": -150,
      "median:amountBase": -100,
      "min:amountBase": -300,
      "max:amountBase": -50,
      "count:amountBase": 3,
      "countDistinct:categoryId": 2,
    });
  });

  it("builds a pivot with row, column and grand totals", async () => {
    const r = await queryLedger(
      USER,
      {
        period: sept,
        filters: [{ field: "kind", op: "in", values: ["expense", "income"] }],
        pivot: { rows: { field: "categoryId" }, cols: { field: "entityId" }, measure: { fn: "sum", field: "amountBase" } },
        includeRows: false,
      },
      prisma
    );
    const p = r.pivot!;
    const gi = p.rowKeys.indexOf(f.categories.Groceries);
    const pf = p.colKeys.indexOf(f.pfId);
    expect(p.cells[gi][pf]).toBe(-400);
    expect(p.cells[gi][p.colKeys.indexOf(f.pjId)]).toBeNull();
    expect(p.grandTotal).toBe(4550);
  });

  it("pages with an opaque cursor", async () => {
    const first = await queryLedger(USER, { period: { preset: "all", offset: 0 }, page: { limit: 3 } }, prisma);
    expect(first.rows).toHaveLength(3);
    expect(first.pageInfo.hasMore).toBe(true);
    const second = await queryLedger(USER, { period: { preset: "all", offset: 0 }, page: { limit: 3, cursor: first.pageInfo.nextCursor! } }, prisma);
    const all = await queryLedger(USER, { period: { preset: "all", offset: 0 }, page: { limit: 100 } }, prisma);
    expect([...first.rows, ...second.rows].map((x) => x.id)).toEqual(all.rows.slice(0, 6).map((x) => x.id));
  });

  it("shows transfer legs with their counterpart and lists the trash separately", async () => {
    const r = await queryLedger(USER, { period: sept, filters: [{ field: "transferDirection", op: "in", values: ["profit_distribution"] }] }, prisma);
    expect(r.rows).toHaveLength(2);
    const pfLeg = r.rows.find((x) => x.accountId === f.pfChecking)!;
    expect(pfLeg.counterpartAccountId).toBe(f.pjChecking);
    const trash = await queryLedger(USER, { deleted: "only", period: { preset: "all", offset: 0 } }, prisma);
    expect(trash.rows.map((x) => x.id)).toEqual([deletedId]);
  });

  it("selects ids for bulk operations and exports CSV", async () => {
    const ids = await selectEntryIds(USER, { period: sept, dateField: "date", filters: [{ field: "categoryId", op: "in", values: [f.categories.Groceries] }], deleted: "exclude" }, prisma);
    expect(ids).toHaveLength(2);
    const csv = await exportLedgerCsv(USER, { period: sept, dateField: "date", filters: [{ field: "categoryId", op: "in", values: [f.categories.Groceries] }], deleted: "exclude" }, prisma);
    const lines = csv.split("\n");
    expect(lines[0]).toBe("Data,Descrição,Entidade,Conta,Categoria,Tipo,Valor,Moeda,Valor na moeda base,Observações");
    expect(lines).toHaveLength(3);
    expect(lines[1]).toContain("Mercado B,PF,Conta principal,Groceries,Saída,-300");
  });

  it("writes the CSV header in the user's locale", async () => {
    await prisma.user.update({ where: { id: USER }, data: { locale: "en" } });
    try {
      const csv = await exportLedgerCsv(USER, { period: sept, dateField: "date", filters: [], deleted: "exclude" }, prisma);
      expect(csv.split("\n")[0]).toBe("Date,Description,Entity,Account,Category,Type,Amount,Currency,Amount in base currency,Notes");
    } finally {
      await prisma.user.update({ where: { id: USER }, data: { locale: "pt-BR" } });
    }
  });
});
