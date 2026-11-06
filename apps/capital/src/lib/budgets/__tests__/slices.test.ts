import { describe, expect, it } from "vitest";
import { filteredKindTotals, paceForKind, type SliceRow } from "../slices";

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
