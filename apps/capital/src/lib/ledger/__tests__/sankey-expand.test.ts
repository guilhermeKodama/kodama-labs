import { describe, expect, it } from "vitest";
import { buildCashflowSankey, expandOthers, type FlowFact } from "@/lib/ledger/sankey";

const fact = (patch: Partial<FlowFact>): FlowFact => ({ entityId: "pf", counterpartEntityId: null, categoryId: null, flowKind: "out", neutral: false, counts: true, amount: 0, ...patch });

describe("sankey Outros", () => {
  it("opens Outros into its categories, splitting the flow in proportion", () => {
    const graph = buildCashflowSankey(
      [
        fact({ flowKind: "in", categoryId: "salario", amount: 10000 }),
        fact({ categoryId: "aluguel", amount: -5000 }),
        fact({ categoryId: "cafe", amount: -60 }),
        fact({ categoryId: "jornal", amount: -40 }),
      ],
      [{ id: "pf", kind: "personal" }],
    );
    expect(graph.nodes.some((n) => n.kind === "others")).toBe(true);
    const open = expandOthers(graph);
    expect(open.nodes.some((n) => n.kind === "others")).toBe(false);
    const into = (categoryId: string) => {
      const index = open.nodes.findIndex((n) => n.kind === "expense" && n.categoryId === categoryId);
      return open.links.filter((l) => l.target === index).reduce((s, l) => s + l.value, 0);
    };
    expect(into("cafe")).toBeCloseTo(60);
    expect(into("jornal")).toBeCloseTo(40);
    // Every link still points at a node.
    expect(open.links.every((l) => l.source < open.nodes.length && l.target < open.nodes.length)).toBe(true);
  });

  it("leaves a graph without Outros alone", () => {
    const graph = buildCashflowSankey([fact({ categoryId: "aluguel", amount: -100 })], [{ id: "pf", kind: "personal" }]);
    expect(expandOthers(graph)).toBe(graph);
  });
});
