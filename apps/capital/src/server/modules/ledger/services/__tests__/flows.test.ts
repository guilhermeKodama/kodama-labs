import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "../entries";
import { cashflowSankey, type LedgerFlowsResult } from "../flows";

/**
 * The cash-flow sankey over display rows: PJ invoices 10000 and pays Figma
 * 50, distributes 2000 to PF; PF buys groceries (300), puts 1000 into XP
 * (funding a buy whose cash leg must not count again) and gets a 50
 * dividend; a card bill payment moves money inside PF.
 */
const USER = "test-user-ledger-flows-001";
let f: LedgerFixture;
const sept = { from: "2026-09-01", to: "2026-09-30" };

function linkValue(r: LedgerFlowsResult, fromId: string, toId: string): number {
  const from = r.nodes.findIndex((n) => n.id === fromId);
  const to = r.nodes.findIndex((n) => n.id === toId);
  return r.links.filter((l) => l.source === from && l.target === to).reduce((s, l) => s + l.value, 0);
}

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  const e = (accountId: string, amount: number, description: string, date: string, categoryId?: string, kind: "income" | "expense" = "expense") =>
    createEntry(USER, { kind, accountId, amount, description, date, categoryId }, prisma, { skipRules: true });
  await e(f.pjChecking, 10000, "Invoice", "2026-09-02", f.categories.Salary, "income");
  await e(f.pfChecking, 300, "Mercado", "2026-09-05", f.categories.Groceries);
  await e(f.pjChecking, 50, "Figma", "2026-09-10", f.categories.Software);
  await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 2000, date: "2026-09-20" }, prisma);
  await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.card, amount: 120, date: "2026-09-12", direction: "card_payment" }, prisma);
  const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "TAEE11", name: "Taesa" }, prisma);
  await recordOperation(USER, { holdingId: holding.id, type: "buy", quantity: 25, pricePerUnit: 40, totalAmount: 1000, date: "2026-09-16", fundFromAccountId: f.pfChecking }, prisma);
  await recordOperation(USER, { holdingId: holding.id, type: "dividend", totalAmount: 50, date: "2026-09-25" }, prisma);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("cash-flow sankey", () => {
  it("flows receita → PJ → PF → categorias, with investments and each entity's surplus", async () => {
    const r = await cashflowSankey(USER, { period: sept }, prisma);
    const pj = `entity::${f.pjId}`;
    const pf = `entity::${f.pfId}`;
    expect(linkValue(r, `income::${f.categories.Salary}`, pj)).toBe(10000);
    expect(linkValue(r, pj, pf)).toBe(2000);
    expect(linkValue(r, pj, `expense::${f.categories.Software}`)).toBe(50);
    expect(linkValue(r, pj, `surplus::${f.pjId}`)).toBe(7950);
    expect(linkValue(r, "income::none", pf)).toBe(50);
    expect(linkValue(r, pf, `expense::${f.categories.Groceries}`)).toBe(300);
    expect(linkValue(r, pf, "output::investments")).toBe(1000);
    expect(linkValue(r, pf, `surplus::${f.pfId}`)).toBe(750);
    expect(r.totals).toEqual({ income: 10050, expenses: 350, investments: 1000, surplus: 8700, reserves: 0, priorBalance: 0 });
    expect(r.range).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    // The card payment moves money inside PF: no node for it.
    expect(r.nodes.some((n) => n.kind === "transfer_in" || n.kind === "transfer_out")).toBe(false);
  });

  it("shows a distribution as an inflow from PJ when only PF is selected", async () => {
    const r = await cashflowSankey(USER, { period: sept, filters: [{ field: "entityId", op: "in", values: [f.pfId] }] }, prisma);
    expect(r.nodes.some((n) => n.id === `entity::${f.pjId}`)).toBe(false);
    expect(linkValue(r, `in::${f.pjId}`, `entity::${f.pfId}`)).toBe(2000);
    expect(r.totals).toMatchObject({ income: 50, expenses: 300, investments: 1000, surplus: 750, priorBalance: 0 });
  });

  it("validates the threshold", async () => {
    await expect(cashflowSankey(USER, { period: sept, groupThreshold: 2 }, prisma)).rejects.toMatchObject({ name: "ZodError" });
  });
});
