import { toneOf, usage, type PaceTone } from "./pace";

/**
 * The Anual view below md, where twelve month columns do not fit: the
 * figures a category card shows, read from the same rows as the heatmap.
 * Nothing here projects: projected months arrive from the server already
 * filled in.
 */

export interface PhoneMonth {
  month: number;
  spent: number;
  budget: number | null;
  isProjected: boolean;
}

const cents = (n: number) => Math.round(n * 100) / 100;

/**
 * A category's year: spent and budget over the months already lived (the
 * one in progress included, as the KPIs count it), the whole year's
 * budget, and how many lived months passed their budget.
 */
export function rowYear(months: readonly PhoneMonth[]) {
  const lived = months.filter((cell) => !cell.isProjected);
  return {
    spentToDate: cents(lived.reduce((sum, cell) => sum + cell.spent, 0)),
    budgetToDate: cents(lived.reduce((sum, cell) => sum + (cell.budget ?? 0), 0)),
    budgetYear: cents(months.reduce((sum, cell) => sum + (cell.budget ?? 0), 0)),
    overMonths: lived.filter((cell) => cell.budget !== null && cell.budget > 0 && cell.spent > cell.budget).length,
  };
}

/**
 * The bar of a category card: the year's budget used so far, with the
 * mark where the year is. Red once the year's budget is gone, yellow when
 * spending runs more than 12 points ahead of the year (the month rule).
 */
export function yearBar(spentToDate: number, budgetYear: number, yearPace: number | null): { ratio: number; tone: PaceTone } {
  const ratio = usage(spentToDate, budgetYear);
  return { ratio, tone: budgetYear > 0 ? toneOf(ratio, yearPace) : "normal" };
}

export type BarTone = "actual" | "over" | "projected";

export interface MiniBar {
  month: number;
  /** Bar height, 0-1 of the strip. */
  height: number;
  /** Where that month's budget sits, 0-1 of the strip; null without one. */
  budgetAt: number | null;
  tone: BarTone;
}

/**
 * Twelve bars on one scale: the row's largest spend or budget fills the
 * strip, each month gets a tick at its own budget. A lived month over its
 * budget is "over"; projected months keep the projection's look.
 */
export function miniBars(months: readonly PhoneMonth[]): MiniBar[] {
  const scale = Math.max(0, ...months.map((cell) => Math.max(cell.spent, cell.budget ?? 0)));
  return months.map((cell) => {
    const over = !cell.isProjected && cell.budget !== null && cell.budget > 0 && cell.spent > cell.budget;
    return {
      month: cell.month,
      height: scale > 0 ? Math.max(0, cell.spent) / scale : 0,
      budgetAt: scale > 0 && cell.budget !== null && cell.budget > 0 ? cell.budget / scale : null,
      tone: cell.isProjected ? "projected" : over ? "over" : "actual",
    };
  });
}
