import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { budgetComposition } from "../budget-composition";
import { createBudget } from "../budget-crud";

const USER = "test-user-budgets-composition-001";
let f: LedgerFixture;
let c: Record<string, string>;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, {
    categories: [
      ...["Aluguel", "Mercado", "Lazer", "Viagem", "Saude", "Extras", "Cursos"].map((name) => ({ name, type: "expense" as const })),
      { name: "Salario", type: "income" as const },
    ],
  });
  c = f.categories;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const budget = (categoryId: string, amount: number, extra: Record<string, unknown> = {}) =>
  createBudget(USER, { categoryId, amount, effectiveFrom: "2025-01", ...extra } as never, prisma);
const spend = (categoryId: string, amount: number, date: string, accountId = f.pfChecking) =>
  createEntry(USER, { kind: "expense", accountId, amount, date, description: "Compra", categoryId }, prisma, { skipRules: true });

describe("range", () => {
  it.each([
    ["backwards", "2026-05", "2026-04"],
    ["not a month", "2026-05", "agosto"],
    ["month 13", "2026-13", "2026-14"],
    ["month 0", "2026-00", "2026-02"],
    ["more than 36 months", "2020-01", "2023-02"],
  ])("refuses a range that is %s", async (_label, from, to) => {
    await expect(budgetComposition(USER, from, to, prisma)).rejects.toMatchObject({ status: 400, code: "budget.composition_range" });
  });

  it("accepts exactly 36 months and rolls over the year end", async () => {
    const r = await budgetComposition(USER, "2023-01", "2025-12", prisma);
    expect(r.months).toHaveLength(36);
    expect(r.months[11]).toMatchObject({ year: 2023, month: 12 });
    expect(r.months[12]).toMatchObject({ year: 2024, month: 1 });
    const short = await budgetComposition(USER, "2025-11", "2026-02", prisma);
    expect(short.months.map((m) => `${m.year}-${m.month}`)).toEqual(["2025-11", "2025-12", "2026-1", "2026-2"]);
    expect(short).toMatchObject({ from: "2025-11", to: "2026-02" });
  });
});

describe("totals", () => {
  it("splits fixed from variable budgets, counts a null kind as variable, and nets reimbursements", async () => {
    await budget(c.Aluguel, 2000, { kind: "fixo" });
    await budget(c.Mercado, 1000);
    await budget(c.Lazer, 400, { kind: "variavel" });
    await spend(c.Aluguel, 2000, "2026-03-05");
    await spend(c.Mercado, 700, "2026-03-10");
    await spend(c.Mercado, 100, "2026-03-20", f.pjChecking);
    await spend(c.Lazer, 450, "2026-03-12");
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 150, date: "2026-03-15", description: "Reembolso", categoryId: c.Salario, reimbursesCategoryId: c.Mercado }, prisma, { skipRules: true });
    // Outside the month, a transfer and spend with no budget do not count.
    await spend(c.Mercado, 999, "2026-04-02");
    await spend(c.Viagem, 321, "2026-03-22");

    const r = await budgetComposition(USER, "2026-03", "2026-03", prisma);
    const march = r.months[0];
    expect(march.fixo).toEqual({ budgeted: 2000, gross: 2000, reimbursed: 0, net: 2000 });
    expect(march.variavel).toEqual({ budgeted: 1400, gross: 1250, reimbursed: 150, net: 1100 });
    expect(march.total).toEqual({ budgeted: 3400, gross: 3250, reimbursed: 150, net: 3100 });
    // Only variable budgets are ranked, by net cost.
    expect(march.topVariable.map((t) => [t.category, t.net])).toEqual([
      ["Mercado", 650],
      ["Lazer", 450],
    ]);
    expect(march.topVariable[0]).toMatchObject({ category: "Mercado", kind: "variavel", budgeted: 1000, gross: 800, reimbursed: 150, net: 650, entityId: null });
  });

  it("ranks ties by name and cuts the list at the limit", async () => {
    for (const name of ["Cursos", "Extras", "Saude", "Viagem"]) {
      await budget(c[name], 100);
      await spend(c[name], 80, "2026-03-05");
    }
    const all = await budgetComposition(USER, "2026-03", "2026-03", prisma);
    expect(all.months[0].topVariable.map((t) => t.category)).toEqual(["Cursos", "Extras", "Saude", "Viagem"]);
    const top2 = await budgetComposition(USER, "2026-03", "2026-03", prisma, { limit: 2 });
    expect(top2.months[0].topVariable.map((t) => t.category)).toEqual(["Cursos", "Extras"]);
  });

  it("limits to the entities in scope, keeping the budgets for every entity", async () => {
    await budget(c.Mercado, 1000);
    await budget(c.Lazer, 300, { entityId: f.pjId });
    await budget(c.Extras, 200, { entityId: f.pfId });
    await spend(c.Mercado, 100, "2026-03-05", f.pfChecking);
    await spend(c.Mercado, 40, "2026-03-05", f.pjChecking);
    await spend(c.Lazer, 70, "2026-03-06", f.pjChecking);
    const pf = (await budgetComposition(USER, "2026-03", "2026-03", prisma, { entityIds: [f.pfId] })).months[0];
    expect(pf.variavel).toMatchObject({ budgeted: 1200, gross: 100 });
    const pj = (await budgetComposition(USER, "2026-03", "2026-03", prisma, { entityIds: [f.pjId] })).months[0];
    expect(pj.variavel).toMatchObject({ budgeted: 1300, gross: 110 });
    expect(pj.topVariable.map((t) => t.category)).toEqual(["Lazer", "Mercado"]);
  });

  it("converts a budget in another currency to the base currency", async () => {
    await prisma.currency.create({ data: { userId: USER, code: "USD", name: "Dollar", symbol: "$", manualRate: 0.2 } });
    await budget(c.Viagem, 100, { currency: "USD" });
    const r = await budgetComposition(USER, "2026-03", "2026-03", prisma);
    expect(r.months[0].variavel.budgeted).toBe(500);
  });

  it("shows a month before any budget as zeros", async () => {
    await budget(c.Mercado, 100);
    const r = await budgetComposition(USER, "2024-12", "2025-01", prisma);
    expect(r.months[0].total).toEqual({ budgeted: 0, gross: 0, reimbursed: 0, net: 0 });
    expect(r.months[0].topVariable).toEqual([]);
    expect(r.months[1].total.budgeted).toBe(100);
  });
});
