import { toneOf, usage, type PaceTone } from "./pace";

/**
 * The Anual view below md, where twelve month columns do not fit: the
 * figures each phone layout shows, read from the same rows as the
 * heatmap. Nothing here projects: projected months arrive from the
 * server already filled in.
 */

/** The layouts the phone can show, picked with ?mv= while the owner compares them. "table" is the heatmap. */
export const PHONE_LAYOUTS = ["table", "cards", "months", "map"] as const;
export type PhoneLayout = (typeof PHONE_LAYOUTS)[number];

export function parsePhoneLayout(value: string | null | undefined): PhoneLayout {
  return PHONE_LAYOUTS.includes(value as PhoneLayout) ? (value as PhoneLayout) : "table";
}

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

export interface MonthTile {
  month: number;
  spent: number;
  budget: number;
  /** Whole percent of the month's budget, null without one. */
  pct: number | null;
  tense: "actual" | "current" | "projected";
  over: boolean;
}

/** The twelve tiles of the month picker, from the Total row's figures. */
export function monthTiles(monthTotals: readonly number[], monthBudgets: readonly number[], tense: (month: number) => MonthTile["tense"]): MonthTile[] {
  return Array.from({ length: 12 }, (_, i) => {
    const spent = monthTotals[i] ?? 0;
    const budget = monthBudgets[i] ?? 0;
    const tensed = tense(i + 1);
    return {
      month: i + 1,
      spent,
      budget,
      pct: budget > 0 ? Math.round((spent / budget) * 100) : null,
      tense: tensed,
      over: tensed !== "projected" && budget > 0 && spent > budget,
    };
  });
}

/** The month a phone layout opens on: today's month in the current year, December in a past one, January in a future one. */
export function defaultMonth(currentMonth: number, isPast: boolean): number {
  if (isPast) return 12;
  return currentMonth >= 1 && currentMonth <= 12 ? currentMonth : 1;
}
