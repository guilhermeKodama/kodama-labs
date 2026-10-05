import { describe, expect, it } from "vitest";
import { buildCashflowSankey, type FlowEntity, type FlowFact } from "../sankey";

/*
 * Ported from the pre-ledger cashflow-sankey tests (git 16c4070f3^): the
 * same scenarios, fed as display-row facts instead of transactions and
 * transfers. Date ranges, entity filters and FX happen in the query that
 * produces the facts, so those cases become entity-filter facts here.
 */

const PF = "personal-1";
const PJ_A = "business-a";
const PJ_B = "business-b";
const entities: FlowEntity[] = [
  { id: PF, kind: "personal" },
  { id: PJ_A, kind: "business" },
  { id: PJ_B, kind: "business" },
];

const fact = (overrides: Partial<FlowFact> & Pick<FlowFact, "amount">): FlowFact => ({
  entityId: PF,
  counterpartEntityId: null,
  categoryId: "General",
  flowKind: overrides.amount > 0 ? "in" : "out",
  neutral: false,
  counts: true,
  ...overrides,
});
const income = (entityId: string, categoryId: string | null, amount: number) => fact({ entityId, categoryId, flowKind: "in", amount });
const expense = (entityId: string, categoryId: string | null, amount: number) => fact({ entityId, categoryId, flowKind: "out", amount: -amount });
/** A transfer with both legs selected: neutral, from → to. */
const neutral = (from: string, to: string, amount: number) => fact({ entityId: from, counterpartEntityId: to, categoryId: null, flowKind: "transfer", neutral: true, counts: false, amount });

function linkValue(r: ReturnType<typeof buildCashflowSankey>, fromId: string, toId: string): number {
  const from = r.nodes.findIndex((n) => n.id === fromId);
  const to = r.nodes.findIndex((n) => n.id === toId);
  if (from < 0 || to < 0) return 0;
  return r.links.filter((l) => l.source === from && l.target === to).reduce((s, l) => s + l.value, 0);
}

const node = (id: string) => `entity::${id}`;

describe("buildCashflowSankey", () => {
  it("returns nothing without data", () => {
    const r = buildCashflowSankey([], entities);
    expect(r.nodes).toEqual([]);
    expect(r.links).toEqual([]);
    expect(r.totals).toEqual({ income: 0, expenses: 0, investments: 0, surplus: 0, reserves: 0, priorBalance: 0 });
  });

  describe("income", () => {
    it("routes business income through category → business → surplus", () => {
      const r = buildCashflowSankey([income(PJ_A, "Clients", 10000)], entities);
      expect(linkValue(r, "income::Clients", node(PJ_A))).toBe(10000);
      expect(linkValue(r, node(PJ_A), `surplus::${PJ_A}`)).toBe(10000);
      expect(r.totals).toMatchObject({ income: 10000, surplus: 10000 });
      expect(r.nodes.find((n) => n.id === node(PJ_A))).toMatchObject({ kind: "business", layer: "business", entityId: PJ_A });
      expect(r.nodes.find((n) => n.id === "income::Clients")).toMatchObject({ kind: "category", layer: "income", categoryId: "Clients" });
    });

    it("routes personal income straight to the person", () => {
      const r = buildCashflowSankey([income(PF, "Salary", 5000)], entities);
      expect(linkValue(r, "income::Salary", node(PF))).toBe(5000);
      expect(r.nodes.find((n) => n.id === node(PF))).toMatchObject({ kind: "personal", layer: "personal" });
      expect(r.totals.income).toBe(5000);
    });

    it("keeps uncategorized income as its own node", () => {
      const r = buildCashflowSankey([income(PF, null, 50)], entities);
      expect(r.nodes.find((n) => n.id === "income::none")).toMatchObject({ categoryId: null });
    });
  });

  describe("PJ → PF", () => {
    it("links a business to the person by the distributed amount", () => {
      const r = buildCashflowSankey([income(PJ_A, "Clients", 38000), neutral(PJ_A, PF, 18000)], entities);
      expect(linkValue(r, node(PJ_A), node(PF))).toBe(18000);
      expect(linkValue(r, node(PJ_A), `surplus::${PJ_A}`)).toBe(20000);
      expect(linkValue(r, node(PF), `surplus::${PF}`)).toBe(18000);
    });

    it("puts businesses before the person in the node order", () => {
      const r = buildCashflowSankey([expense(PF, "Rent", 100), income(PJ_A, "Clients", 1000), neutral(PJ_A, PF, 500)], entities);
      const order = r.nodes.filter((n) => n.kind === "business" || n.kind === "personal").map((n) => n.entityId);
      expect(order).toEqual([PJ_A, PF]);
    });

    it("draws a reimbursement from the business like any business → person flow", () => {
      const r = buildCashflowSankey([income(PJ_A, "Clients", 10000), expense(PF, "Travel", 500), neutral(PJ_A, PF, 500)], entities);
      expect(r.totals.income).toBe(10000);
      expect(linkValue(r, node(PF), "expense::Travel")).toBe(500);
      expect(linkValue(r, node(PJ_A), node(PF))).toBe(500);
      expect(r.totals.priorBalance).toBe(0);
    });

    it("sends PF → PJ capital through transfer nodes, so the graph never cycles", () => {
      const r = buildCashflowSankey([income(PF, "Salary", 3000), neutral(PF, PJ_A, 1000), expense(PJ_A, "Software", 1000)], entities);
      expect(linkValue(r, node(PF), `out::${PJ_A}`)).toBe(1000);
      expect(linkValue(r, `in::${PF}`, node(PJ_A))).toBe(1000);
      expect(linkValue(r, node(PF), node(PJ_A))).toBe(0);
      expect(r.nodes.find((n) => n.id === `out::${PJ_A}`)).toMatchObject({ kind: "transfer_out", layer: "output", entityId: PJ_A });
      expect(r.totals.priorBalance).toBe(0);
    });

    it("ignores moves within one entity (card payments, between own accounts)", () => {
      const r = buildCashflowSankey([income(PF, "Salary", 1000), neutral(PF, PF, 700)], entities);
      expect(r.links).toHaveLength(2);
      expect(linkValue(r, node(PF), `surplus::${PF}`)).toBe(1000);
    });
  });

  describe("expenses", () => {
    it("routes expenses through their categories and nets refunds", () => {
      const r = buildCashflowSankey(
        [income(PF, "Salary", 10000), expense(PF, "Rent", 3000), expense(PF, "Food", 900), fact({ categoryId: "Food", flowKind: "out", amount: 100 })],
        entities
      );
      expect(linkValue(r, node(PF), "expense::Rent")).toBe(3000);
      expect(linkValue(r, node(PF), "expense::Food")).toBe(800);
      expect(r.totals.expenses).toBe(3800);
      expect(linkValue(r, node(PF), `surplus::${PF}`)).toBe(6200);
    });

    it("folds categories under 2% of expenses into Outros", () => {
      const r = buildCashflowSankey(
        [income(PF, "Salary", 50000), expense(PF, "Rent", 9000), expense(PF, "Coffee", 50), expense(PF, "Snacks", 30), expense(PF, "Streaming", 20)],
        entities
      );
      expect(linkValue(r, node(PF), "expense::Rent")).toBe(9000);
      expect(linkValue(r, node(PF), "expense::__others__")).toBe(100);
      const others = r.nodes.find((n) => n.id === "expense::__others__");
      expect(others?.kind).toBe("others");
      expect(others?.subItems).toEqual([
        { categoryId: "Coffee", value: 50 },
        { categoryId: "Snacks", value: 30 },
        { categoryId: "Streaming", value: 20 },
      ]);
    });

    it("takes a custom threshold", () => {
      const r = buildCashflowSankey([income(PF, "Salary", 1000), expense(PF, "A", 500), expense(PF, "B", 50)], entities, { groupThreshold: 0.5 });
      expect(linkValue(r, node(PF), "expense::__others__")).toBe(50);
      expect(r.nodes.find((n) => n.id === "expense::B")).toBeUndefined();
    });
  });

  describe("investments", () => {
    it("sends aportes to Investimentos and skips the uncounted broker legs", () => {
      const r = buildCashflowSankey(
        [
          income(PF, "Salary", 10000),
          fact({ flowKind: "invest", categoryId: null, amount: -2500 }),
          fact({ flowKind: "invest", categoryId: null, counts: false, amount: -2500 }),
        ],
        entities
      );
      expect(linkValue(r, node(PF), "output::investments")).toBe(2500);
      expect(r.totals.investments).toBe(2500);
      expect(linkValue(r, node(PF), `surplus::${PF}`)).toBe(7500);
    });

    it("brings resgates in from Das reservas before balancing", () => {
      const r = buildCashflowSankey([expense(PF, "Medical", 1800), fact({ flowKind: "invest", categoryId: null, amount: 2000 })], entities);
      expect(linkValue(r, "income::__reserves__", node(PF))).toBe(2000);
      expect(r.totals.reserves).toBe(2000);
      expect(linkValue(r, node(PF), `surplus::${PF}`)).toBe(200);
      expect(r.totals.priorBalance).toBe(0);
    });

    it("shows both reserves and the prior balance when a resgate does not cover the gap", () => {
      const r = buildCashflowSankey([expense(PF, "Rent", 1500), fact({ flowKind: "invest", categoryId: null, amount: 500 })], entities);
      expect(linkValue(r, "income::__reserves__", node(PF))).toBe(500);
      expect(linkValue(r, "income::__prior_balance__", node(PF))).toBe(1000);
      expect(r.totals).toMatchObject({ reserves: 500, priorBalance: 1000 });
    });
  });

  describe("deficit", () => {
    it("balances spending above income with Saldo anterior", () => {
      const r = buildCashflowSankey([income(PJ_A, "Clients", 1000), expense(PF, "Rent", 1500), neutral(PJ_A, PF, 1000)], entities);
      expect(linkValue(r, "income::__prior_balance__", node(PF))).toBe(500);
      expect(r.totals).toMatchObject({ priorBalance: 500, reserves: 0, income: 1000 });
      expect(r.nodes.find((n) => n.id === "income::__prior_balance__")?.kind).toBe("prior_balance");
      expect(r.nodes.find((n) => n.id === "income::__reserves__")).toBeUndefined();
    });

    it("adds no Saldo anterior when income covers spending", () => {
      const r = buildCashflowSankey([income(PF, "Salary", 1000), expense(PF, "Rent", 500)], entities);
      expect(r.nodes.find((n) => n.id === "income::__prior_balance__")).toBeUndefined();
      expect(r.totals.priorBalance).toBe(0);
    });
  });

  describe("entity filter (one leg of a transfer selected)", () => {
    it("shows a distribution received as an inflow from the business, without a ghost business node", () => {
      // PF only: the PJ → PF transfer is a counted +9000 on PF.
      const r = buildCashflowSankey([fact({ entityId: PF, counterpartEntityId: PJ_A, categoryId: null, flowKind: "transfer", amount: 9000 })], entities);
      expect(r.nodes.find((n) => n.id === node(PJ_A))).toBeUndefined();
      expect(linkValue(r, `in::${PJ_A}`, node(PF))).toBe(9000);
      expect(linkValue(r, node(PF), `surplus::${PF}`)).toBe(9000);
      expect(r.totals.priorBalance).toBe(0);
    });

    it("shows a distribution paid as an outflow to the person when only the business is selected", () => {
      const r = buildCashflowSankey(
        [income(PJ_A, "Clients", 10000), fact({ entityId: PJ_A, counterpartEntityId: PF, categoryId: null, flowKind: "transfer", amount: -6000 })],
        entities
      );
      expect(linkValue(r, node(PJ_A), `out::${PF}`)).toBe(6000);
      expect(r.nodes.find((n) => n.id === node(PF))).toBeUndefined();
      expect(linkValue(r, node(PJ_A), `surplus::${PJ_A}`)).toBe(4000);
    });

    it("ignores facts of unknown entities", () => {
      const r = buildCashflowSankey([income("ghost", "X", 10)], entities);
      expect(r.nodes).toEqual([]);
    });
  });

  it("keeps the diagram balanced: every entity's inflow equals its outflow", () => {
    const r = buildCashflowSankey(
      [
        income(PJ_A, "Clients", 20000),
        income(PJ_B, "Clients", 3000),
        expense(PJ_A, "Taxes", 1200),
        expense(PJ_B, "Software", 4000),
        neutral(PJ_A, PF, 15000),
        neutral(PJ_A, PJ_B, 500),
        expense(PF, "Rent", 4200),
        fact({ flowKind: "invest", categoryId: null, amount: -8000 }),
        income(PF, null, 312.8),
      ],
      entities
    );
    for (let i = 0; i < r.nodes.length; i++) {
      if (r.nodes[i].kind !== "business" && r.nodes[i].kind !== "personal") continue;
      const inflow = r.links.filter((l) => l.target === i).reduce((s, l) => s + l.value, 0);
      const outflow = r.links.filter((l) => l.source === i).reduce((s, l) => s + l.value, 0);
      expect(inflow).toBeCloseTo(outflow, 6);
    }
    expect(r.totals.income).toBeCloseTo(23312.8, 6);
    expect(linkValue(r, "income::__prior_balance__", node(PJ_B))).toBeCloseTo(500, 6);
  });
});
