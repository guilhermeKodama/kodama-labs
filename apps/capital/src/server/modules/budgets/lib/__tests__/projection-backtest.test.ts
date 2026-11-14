import { describe, expect, it } from "vitest";
import { errors, formatReport, runBacktest, syntheticSeries } from "../projection-backtest";

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
    expect(errors("vazio", [])).toMatchObject({ n: 0, maeOld: 0, mapeNew: 0 });
  });
});
