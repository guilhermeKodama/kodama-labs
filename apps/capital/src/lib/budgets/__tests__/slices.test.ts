import { describe, expect, it } from "vitest";
import { filteredKindTotals, filteredYearFigures, paceForKind, type SliceRow, type YearFilterRow } from "../slices";

function row(partial: {
  kind: SliceRow["kind"];
  amount: number;
  net: number;
  reimbursed?: number;
  spent?: number;
  remaining?: number;
  available?: number;
  projected?: number;
}): SliceRow {
  return {
    kind: partial.kind,
    amount: partial.amount,
    net: partial.net,
    spent: partial.spent ?? partial.net,
    remaining: partial.remaining ?? partial.amount - partial.net,
    reimbursed: partial.reimbursed ?? 0,
    available: partial.available ?? partial.amount,
    pace: { projectedTotal: partial.projected ?? partial.net },
  };
}

const rows: SliceRow[] = [
  row({ kind: "fixo", amount: 500, net: 200, reimbursed: 50, spent: 250, remaining: 300, available: 500, projected: 400 }),
  row({ kind: null, amount: 800, net: 100, remaining: 700, available: 800, projected: 300 }),
  row({ kind: "variavel", amount: 200, net: 40, remaining: 160, available: 200, projected: 90 }),
];

describe("filtered kind totals", () => {
  it("splits líquido by kind and counts a budget with no kind as variável", () => {
    const all = filteredKindTotals(rows, null);
    expect(all.fixo).toMatchObject({ budget: 500, net: 200, remaining: 300, reimbursed: 50, projected: 400 });
    expect(all.variavel).toMatchObject({ budget: 1000, net: 140, remaining: 860, reimbursed: 0, projected: 390 });
    expect(all.total.net).toBe(340);
    expect(all.rows).toHaveLength(3);
  });

  it("drops the other kind when the filter is on, including the total", () => {
    const fixo = filteredKindTotals(rows, "fixo");
    expect(fixo.rows).toHaveLength(1);
    expect(fixo.fixo.net).toBe(200);
    expect(fixo.variavel).toMatchObject({ budget: 0, net: 0, remaining: 0 });
    expect(fixo.total).toMatchObject({ budget: 500, net: 200, remaining: 300 });

    const variavel = filteredKindTotals(rows, "variavel");
    expect(variavel.fixo.net).toBe(0);
    expect(variavel.variavel.net).toBe(140);
    expect(variavel.total.net).toBe(140);
  });
});

describe("filtered year figures", () => {
  const cell = (spent: number, budget: number | null) => ({ spent, budget });
  const blank = cell(0, null);
  const yearRow = (kind: YearFilterRow["kind"], january: { spent: number; budget: number | null }, february: { spent: number; budget: number | null }, overMonths: number): YearFilterRow => ({
    kind,
    isBudgeted: true,
    months: [january, february, ...Array.from({ length: 10 }, () => blank)],
    overMonths,
    budgetedMonths: 2,
  });
  const rows = [
    yearRow("fixo", cell(100, 400), cell(100, 400), 0),
    yearRow(null, cell(50, 200), cell(80, 200), 1),
  ];

  it("keeps every row when the filter is Todos, and a null kind stays in variável", () => {
    const all = filteredYearFigures(rows, null, 2);
    expect(all.rows).toHaveLength(2);
    expect(all.monthTotals.slice(0, 2)).toEqual([150, 180]);
    expect(all.monthBudgets.slice(0, 2)).toEqual([600, 600]);
    expect(all.summary).toMatchObject({ spentToDate: 330, budgetToDate: 1200, projectedYear: 330, budgetYear: 1200, overBudgetMonths: 1, budgetedCells: 4 });
  });

  it("recomputes the year total, the chart and the budget from the matching kind only", () => {
    const fixo = filteredYearFigures(rows, "fixo", 2);
    expect(fixo.rows).toHaveLength(1);
    expect(fixo.monthTotals[0]).toBe(100);
    expect(fixo.monthBudgets[0]).toBe(400);
    expect(fixo.summary).toMatchObject({ spentToDate: 200, budgetToDate: 800, projectedYear: 200, budgetYear: 800, overBudgetMonths: 0, budgetedCells: 2 });

    const variavel = filteredYearFigures(rows, "variavel", 2);
    expect(variavel.monthTotals.slice(0, 2)).toEqual([50, 80]);
    expect(variavel.summary.spentToDate).toBe(130);
    expect(variavel.summary.budgetToDate).toBe(400);
  });
});

describe("pace series for the kind filter", () => {
  const series = [
    { day: 1, cumulative: 30, fixo: 20, variavel: 10, ideal: 50 },
    { day: 2, cumulative: 80, fixo: 50, variavel: 30, ideal: 100 },
  ];

  it("keeps both areas and rebuilds the ideal line from every budget when the filter is Todos", () => {
    const points = paceForKind(series, rows, null, 30);
    expect(points[1]).toEqual({ day: 2, fixo: 50, variavel: 30, cumulative: 80, ideal: 100 });
  });

  it("keeps only the filtered kind under the cumulative line", () => {
    const points = paceForKind(series, rows, "fixo", 30);
    expect(points[1]).toEqual({ day: 2, fixo: 50, variavel: 0, cumulative: 50, ideal: 33.33 });
    expect(paceForKind(series, rows, "variavel", 30)[1]).toMatchObject({ fixo: 0, variavel: 30, cumulative: 30 });
  });
});
