import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { FLOW_CATEGORY_KEYS } from "@/lib/ledger/flow-category";
import type { LedgerDisplayRow, LedgerQueryInput } from "../../contracts";
import { createEntry } from "../entries";
import { exportLedgerCsv, queryLedger, resolvePeriod } from "../query-engine";

/**
 * Display mode (what the UI sends): one row per transfer, KPIs and calcs
 * over counted rows. September 2026 holds:
 * - PJ: Invoice +10000 (Salary), Figma −50 (Software)
 * - PJ → PF profit distribution 2000
 * - PF: Mercado −300 (Groceries), an aporte of 1000 into XP that funds a
 *   1000 buy (the buy's cash leg on XP does not count), a dividend +50 on XP
 * August: Mercado −999 (PF).
 */
const USER = "test-user-ledger-display-001";
let f: LedgerFixture;
let transferGroupId: string;
let pfTransferLeg: string;
let fundingGroupId: string;
const sept = { from: "2026-09-01", to: "2026-09-30" };
const all = { preset: "all" as const, offset: 0 };

const display = (input: LedgerQueryInput) => queryLedger(USER, { ...input, semantics: "display" }, prisma);
const byDescription = (rows: LedgerDisplayRow[], text: string) => rows.filter((r) => r.description.includes(text));

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const e = (accountId: string, amount: number, description: string, date: string, categoryId?: string, kind: "income" | "expense" = "expense") =>
    createEntry(USER, { kind, accountId, amount, description, date, categoryId }, prisma, { skipRules: true });
  await e(f.pjChecking, 10000, "Invoice", "2026-09-02", f.categories.Salary, "income");
  await e(f.pfChecking, 300, "Mercado", "2026-09-05", f.categories.Groceries);
  await e(f.pjChecking, 50, "Figma", "2026-09-10", f.categories.Software);
  await e(f.pfChecking, 999, "Mercado", "2026-08-30", f.categories.Groceries);
  const transfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 2000, date: "2026-09-20" }, prisma);
  transferGroupId = transfer.transferGroupId!;
  pfTransferLeg = transfer.entryIds[1];
  const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "TAEE11", name: "Taesa" }, prisma);
  const buy = await recordOperation(USER, { holdingId: holding.id, type: "buy", quantity: 25, pricePerUnit: 40, totalAmount: 1000, date: "2026-09-16", fundFromAccountId: f.pfChecking }, prisma);
  fundingGroupId = buy.fundingGroupId!;
  await recordOperation(USER, { holdingId: holding.id, type: "dividend", totalAmount: 50, date: "2026-09-25" }, prisma);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("display rows", () => {
  it("shows a transfer between entities as one neutral row and keeps it out of the KPIs", async () => {
    const r = await display({ period: sept });
    expect(r.totals?.count).toBe(7);
    expect(r.summary).toEqual({ income: 10050, expense: 350, investment: 1000, net: 8700, count: 7 });
    const [transfer] = r.rows.filter((x) => x.transferGroupId === transferGroupId);
    expect(transfer).toMatchObject({
      neutral: true,
      counts: false,
      displayAmount: 2000,
      flowKind: "transfer",
      entityId: f.pjId,
      accountId: f.pjChecking,
      counterpartEntityId: f.pfId,
      counterpartAccountId: f.pfChecking,
    });
    expect(transfer.legIds).toHaveLength(2);
    expect(transfer.legIds[0]).toBe(transfer.id);
    expect(r.rows.filter((x) => x.transferGroupId === transferGroupId)).toHaveLength(1);
  });

  it("turns the transfer into Entrada for PF and Saída for PJ", async () => {
    const pf = await display({ period: sept, filters: [{ field: "entityId", op: "in", values: [f.pfId] }] });
    const pfTransfer = pf.rows.find((x) => x.transferGroupId === transferGroupId)!;
    expect(pfTransfer).toMatchObject({ neutral: false, counts: true, displayAmount: 2000, entityId: f.pfId, legIds: [pfTransferLeg] });
    expect(pf.summary).toEqual({ income: 2050, expense: 300, investment: 1000, net: 750, count: 5 });

    const pj = await display({ period: sept, filters: [{ field: "entityId", op: "in", values: [f.pjId] }] });
    const pjTransfer = pj.rows.find((x) => x.transferGroupId === transferGroupId)!;
    expect(pjTransfer).toMatchObject({ neutral: false, counts: true, displayAmount: -2000, entityId: f.pjId });
    expect(pj.summary).toEqual({ income: 10000, expense: 2050, investment: 0, net: 7950, count: 3 });
  });

  it("counts an aporte once: the funding transfer, not the broker's buy leg", async () => {
    const r = await display({ period: sept, filters: [{ field: "flowKind", op: "in", values: ["invest"] }] });
    expect(r.rows).toHaveLength(2);
    const aporte = r.rows.find((x) => x.transferGroupId === fundingGroupId)!;
    expect(aporte).toMatchObject({ counts: true, neutral: false, displayAmount: -1000, accountId: f.pfChecking, counterpartAccountId: f.broker, operationType: "buy" });
    expect(aporte.linkedOperationId).toBeTruthy();
    const buyLeg = r.rows.find((x) => x.id !== aporte.id)!;
    expect(buyLeg).toMatchObject({ counts: false, accountId: f.broker, kind: "investment", operationType: "buy", linkedOperationId: aporte.linkedOperationId });
    expect(r.summary).toMatchObject({ investment: 1000, income: 0, expense: 0, net: -1000 });

    // Seen from the broker alone, the aporte is still one counted outflow into investments.
    const broker = await display({ period: sept, filters: [{ field: "accountId", op: "in", values: [f.broker] }] });
    expect(broker.summary).toEqual({ income: 50, expense: 0, investment: 1000, net: -950, count: 3 });
  });

  it("aggregates over counted rows and counts every display row", async () => {
    const r = await display({
      period: sept,
      includeRows: false,
      aggregations: [
        { fn: "sum", field: "amountBase" },
        { fn: "avg", field: "amountBase" },
        { fn: "median", field: "amountBase" },
        { fn: "min", field: "amountBase" },
        { fn: "max", field: "amountBase" },
        { fn: "count", field: "amountBase" },
      ],
    });
    expect(r.totals?.values).toEqual({
      "sum:amountBase": 8700,
      "avg:amountBase": 1740,
      "median:amountBase": -50,
      "min:amountBase": -1000,
      "max:amountBase": 10000,
      "count:amountBase": 7,
    });
    const counted = await display({ period: sept, rowsScope: "counted", includeRows: false });
    expect(counted.totals?.count).toBe(5);
    expect(counted.summary?.net).toBe(8700);
  });

  it("counts distinct values of any field, dates by bucket", async () => {
    const r = await display({
      period: all,
      includeRows: false,
      filters: [{ field: "flowKind", op: "in", values: ["out"] }],
      aggregations: [
        { fn: "count", field: "amountBase" },
        { fn: "countDistinct", field: "description" },
        { fn: "countDistinct", field: "date", bucket: "month" },
        { fn: "countDistinct", field: "date" },
        { fn: "countDistinct", field: "entityId" },
      ],
    });
    expect(r.totals?.values).toEqual({
      "count:amountBase": 3,
      "countDistinct:description": 2,
      "countDistinct:date:month": 2,
      "countDistinct:date": 3,
      "countDistinct:entityId": 2,
    });
    await expect(display({ period: all, aggregations: [{ fn: "countDistinct", field: "entityId", bucket: "month" }] })).rejects.toMatchObject({
      code: "query.unknown_aggregation_field",
    });
    await expect(display({ period: all, aggregations: [{ fn: "sum", field: "description" }] })).rejects.toMatchObject({ code: "query.aggregation_needs_numeric" });
  });

  it("filters by date buckets: month, quarter and week of the month", async () => {
    const august = await display({ period: all, filters: [{ field: "date", op: "inBuckets", bucket: "month", values: ["2026-08"] }] });
    expect(august.rows.map((x) => x.amountBase)).toEqual([-999]);
    const q3 = await display({ period: all, filters: [{ field: "date", op: "inBuckets", bucket: "quarter", values: ["2026-Q3"] }] });
    expect(q3.totals?.count).toBe(8);
    const firstWeek = await display({ period: all, filters: [{ field: "date", op: "inBuckets", bucket: "monthWeek", values: ["2026-09-W1"] }] });
    expect(firstWeek.rows.map((x) => x.description).sort()).toEqual(["Invoice", "Mercado"]);
    const weeks = await display({ period: sept, includeRows: false, groupBy: [{ field: "date", bucket: "monthWeek" }] });
    expect(weeks.groups.map((g) => g.key)).toEqual(["2026-09-W1", "2026-09-W2", "2026-09-W3", "2026-09-W4"]);
    expect(weeks.groups.map((g) => g.count)).toEqual([2, 1, 3, 1]);
    const none = await display({ period: all, filters: [{ field: "date", op: "inBuckets", bucket: "year", values: ["2025"] }] });
    expect(none.totals?.count).toBe(0);
  });

  it("searches category, account and entity names without splitting a transfer", async () => {
    const groceries = await display({ period: all, search: "groceries" });
    expect(groceries.rows.map((x) => x.amountBase).sort((a, b) => a - b)).toEqual([-999, -300]);
    const kodama = await display({ period: sept, search: "kodama" });
    expect(kodama.rows.map((x) => x.description).sort()).toEqual(["Distribuição de lucros: Conta principal → Conta principal", "Figma", "Invoice"]);
    expect(kodama.rows.find((x) => x.transferGroupId === transferGroupId)).toMatchObject({ neutral: true, counts: false });
    const xp = await display({ period: sept, search: "XP" });
    expect(xp.totals?.count).toBe(3);
    expect(xp.rows.find((x) => x.transferGroupId === fundingGroupId)?.legIds).toHaveLength(2);
    // Wildcards are literal.
    const literal = await display({ period: all, search: "Inv_ice" });
    expect(literal.totals?.count).toBe(0);
  });

  it("pages over display rows and never splits a transfer", async () => {
    const seen: LedgerDisplayRow[] = [];
    let cursor: string | undefined;
    do {
      const page = await display({ period: sept, page: { limit: 2, cursor }, sort: [{ field: "absAmountBase", dir: "desc" }] });
      seen.push(...page.rows);
      cursor = page.pageInfo.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen.map((x) => x.id)).size).toBe(7);
    expect(seen.filter((x) => x.transferGroupId === transferGroupId)).toHaveLength(1);
    expect(seen.map((x) => Math.abs(x.displayAmount))).toEqual([10000, 2000, 1000, 1000, 300, 50, 50]);
  });

  it("groups display rows; a neutral transfer groups under from→to", async () => {
    const r = await display({ period: sept, groupBy: [{ field: "entityId" }] });
    expect(r.groups).toEqual([
      { key: f.pjId, count: 2, values: { "sum:amountBase": 9950, "count:amountBase": 2 } },
      { key: f.pfId, count: 4, values: { "sum:amountBase": -1250, "count:amountBase": 4 } },
      { key: `${f.pjId}→${f.pfId}`, count: 1, values: { "sum:amountBase": 0, "count:amountBase": 1 } },
    ]);
    // Rows follow the group order and carry their keys.
    expect(r.rows.map((x) => x.groupKeys?.[0])).toEqual([f.pjId, f.pjId, f.pfId, f.pfId, f.pfId, f.pfId, `${f.pjId}→${f.pfId}`]);

    const byAccount = await display({ period: sept, groupBy: [{ field: "accountId" }], includeRows: false });
    expect(byAccount.groups.map((g) => g.key)).toContain(`${f.pjChecking}→${f.pfChecking}`);
    // The aporte counts, so it groups under its account, not as a pair.
    expect(byAccount.groups.map((g) => g.key)).not.toContain(`${f.pfChecking}→${f.broker}`);

    const counted = await display({ period: sept, rowsScope: "counted", groupBy: [{ field: "entityId" }, { field: "categoryId" }], includeRows: false });
    expect(counted.groups.map((g) => g.key)).toEqual([f.pjId, f.pfId]);
    expect(counted.groups[0].children?.map((c) => [c.key, c.values["sum:amountBase"]])).toEqual([
      [f.categories.Salary, 10000],
      [f.categories.Software, -50],
    ]);
  });

  it("builds a pivot over counted rows", async () => {
    const r = await display({
      period: sept,
      rowsScope: "counted",
      includeRows: false,
      pivot: { rows: { field: "categoryId" }, cols: { field: "entityId" }, measure: { fn: "sum", field: "amountBase" } },
    });
    const p = r.pivot!;
    expect(p.colKeys).toEqual([f.pjId, f.pfId]);
    expect(p.cells[p.rowKeys.indexOf(f.categories.Groceries)]).toEqual([null, -300]);
    // The uncategorized aporte is Investimentos; Sem categoria keeps the dividend only.
    expect(p.cells[p.rowKeys.indexOf(FLOW_CATEGORY_KEYS.invest)]).toEqual([null, -1000]);
    expect(p.cells[p.rowKeys.indexOf(null)]).toEqual([null, 50]);
    expect(p.grandTotal).toBe(8700);
  });

  it("groups uncategorized aportes and counted transfers apart from Sem categoria, and filters back to them", async () => {
    const byCategory = await display({ period: sept, rowsScope: "counted", groupBy: [{ field: "categoryId" }], includeRows: false });
    const sums = new Map(byCategory.groups.map((g) => [g.key, g.values["sum:amountBase"]]));
    expect(sums.get(FLOW_CATEGORY_KEYS.invest)).toBe(-1000);
    expect(sums.get(null)).toBe(50);
    expect(sums.has(FLOW_CATEGORY_KEYS.transfer)).toBe(false);

    // Seen from PF, the profit distribution counts and groups as Transferência.
    const pf = await display({ period: sept, rowsScope: "counted", groupBy: [{ field: "categoryId" }], filters: [{ field: "entityId", op: "in", values: [f.pfId] }] });
    expect(pf.groups.find((g) => g.key === FLOW_CATEGORY_KEYS.transfer)?.values["sum:amountBase"]).toBe(2000);
    expect(pf.rows.find((x) => x.transferGroupId === transferGroupId)?.groupKeys).toEqual([FLOW_CATEGORY_KEYS.transfer]);

    // A drill into Investimentos: the aporte (counted) and the broker's buy leg (not counted).
    const invest = await display({ period: sept, filters: [{ field: "categoryId", op: "in", values: [FLOW_CATEGORY_KEYS.invest] }] });
    expect(invest.rows.map((x) => x.flowKind)).toEqual(["invest", "invest"]);
    expect(invest.summary).toMatchObject({ investment: 1000, count: 2 });

    // Sem categoria (null) is uncategorized income and expenses only; isNull still matches every empty category.
    const none = await display({ period: sept, filters: [{ field: "categoryId", op: "in", values: [null] }] });
    expect(none.rows.map((x) => [x.flowKind, x.displayAmount])).toEqual([["in", 50]]);
    const notNone = await display({ period: sept, includeRows: false, filters: [{ field: "categoryId", op: "nin", values: [null, FLOW_CATEGORY_KEYS.invest] }] });
    expect(notNone.totals?.count).toBe(4);
    const empty = await display({ period: sept, includeRows: false, filters: [{ field: "categoryId", op: "isNull" }] });
    expect(empty.totals?.count).toBe(4);
  });

  it("skips totals for a cheap search", async () => {
    const r = await display({ period: all, search: "Invoice", skipTotals: true, page: { limit: 8 } });
    expect(r.totals).toBeNull();
    expect(r.summary).toBeNull();
    expect(r.rows.map((x) => x.description)).toEqual(["Invoice"]);
  });

  it("keeps legs mode as it was (one row per leg, every leg counted)", async () => {
    const r = await queryLedger(USER, { period: sept }, prisma);
    expect(r.totals.count).toBe(9);
    expect(r.rows.filter((x) => x.transferGroupId === transferGroupId)).toHaveLength(2);
    expect("summary" in r).toBe(false);
    expect("legIds" in r.rows[0]).toBe(false);
  });
});

describe("export by ids", () => {
  it("exports the selected rows, both legs of a transfer, with Tipo in the user's language", async () => {
    const [mercado] = byDescription((await display({ period: sept, search: "Mercado" })).rows, "Mercado");
    const csv = await exportLedgerCsv(USER, { ids: [pfTransferLeg, mercado.id] }, prisma);
    const lines = csv.split("\n");
    expect(lines).toHaveLength(4);
    expect(lines.filter((l) => l.includes("Transferência"))).toHaveLength(2);
    expect(lines.some((l) => l.includes("Mercado,PF,Conta principal,Groceries,Saída,-300"))).toBe(true);
  });
});

describe("ytd", () => {
  it("runs from January to the current month; a past year is whole", () => {
    const now = new Date();
    const ytd = resolvePeriod({ preset: "ytd", offset: 0 }, "UTC");
    expect(ytd.from?.toISOString()).toBe(`${now.getUTCFullYear()}-01-01T00:00:00.000Z`);
    expect(ytd.to?.getUTCMonth()).toBe(now.getUTCMonth());
    expect(ytd.to?.getUTCFullYear()).toBe(now.getUTCFullYear());
    const last = resolvePeriod({ preset: "ytd", offset: -1 }, "UTC");
    expect(last.from?.toISOString()).toBe(`${now.getUTCFullYear() - 1}-01-01T00:00:00.000Z`);
    expect(last.to?.toISOString()).toBe(`${now.getUTCFullYear() - 1}-12-31T23:59:59.999Z`);
  });
});
