import { describe, expect, it } from "vitest";
import { errors, formatReport, intraMonthPoints, runBacktest, syntheticSeries, type Series } from "../projection-backtest";

describe("synthetic backtest", () => {
  const series = syntheticSeries(60, 14, 7);
  const report = runBacktest(series);
  const row = (rows: typeof report.byCard, label: string) => rows.find((r) => r.label === label)!;

  it("is reproducible from its seed", () => {
    expect(runBacktest(syntheticSeries(60, 14, 7))).toEqual(report);
  });

  it("beats the old forecast on the cards and stops quoting trends past 200%", () => {
    expect(row(report.byCard, "Fixo").maeNew).toBeLessThan(row(report.byCard, "Fixo").maeOld / 3);
    expect(row(report.byCard, "Total").maeNew).toBeLessThan(row(report.byCard, "Total").maeOld);
    expect(row(report.byKind, "Todas").mapeNew).toBeLessThan(row(report.byKind, "Todas").mapeOld);
    expect(row(report.future, "Todas").maeNew).toBeLessThanOrEqual(row(report.future, "Todas").maeOld * 1.05);
    expect(report.counts.wildNew).toBe(0);
    expect(report.counts.negativeFutureNew).toBe(0);
  });

  it("prints tables of errors only", () => {
    const text = formatReport(report);
    expect(text).toContain("| Card \"Projeção fim do mês\" |");
    expect(text).toContain("Tendência acima de ±200%");
    expect(text).toContain("gasto líquido negativo");
    expect(errors("vazio", [])).toMatchObject({ n: 0, maeOld: 0, mapeNew: 0 });
  });

  it("derives due from a stale nextDueDate and does not add that rule on top of the charge", () => {
    const posted = (key: string) => ({ day: 1, rawDay: 1, amount: 14732, key });
    const series: Series = {
      household: 1,
      kind: "fixo",
      budget: 16000,
      start: 0,
      origin: "2025-01",
      ruleKeys: new Set(["r-rent"]),
      months: [...Array.from({ length: 6 }, () => [posted("r-rent")]), [posted("aluguel")]],
      rules: [{ key: "r-rent", amount: 14732, nextDue: "2025-04-10", frequency: "monthly", bookedMonths: ["2025-01", "2025-02", "2025-03", "2025-04"] }],
    };
    const point = intraMonthPoints([series]).find((p) => p.month === 6 && p.day === 10)!;
    expect(point.actual).toBe(14732);
    expect(point.neu).toBe(14732);
    expect(point.neu).toBeLessThan(point.actual + 14732);
  });
});
