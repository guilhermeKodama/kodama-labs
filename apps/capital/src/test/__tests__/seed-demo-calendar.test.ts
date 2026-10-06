import { describe, expect, it } from "vitest";
import {
  addMonths,
  alignedDay,
  ANCHOR_DAY,
  DAY_TO_DAY,
  dayToDayPurchases,
  dayToDayTarget,
  DEMO_RECURRING,
  demoCalendar,
  HISTORY_FROM,
  isoDate,
  LLC_DISTRIBUTION,
  MOCK_ENTRIES,
  MOCK_MONTHLY,
  MOCK_MONTHS,
  mockPace,
  monthIndex,
  NOTEBOOK,
  planInvestments,
  PROFIT_DISTRIBUTION,
  YEARLY_HISTORY,
} from "../../../scripts/seed-demo-data";

/** The demo seed (prisma/seed-demo.ts) lays the mockup's "today" (22/set) over the real today. */

/** Every date the seed books outside recurring rules, through the calendar of `today`. */
function bookedDates(today: string): string[] {
  const { m0, date, installmentDate } = demoCalendar(today);
  const dates: string[] = [];
  // The notebook's parcels up to M0 (its later parcels are future installments by nature).
  for (let k = NOTEBOOK.k; k <= 0; k++) dates.push(installmentDate(k, NOTEBOOK.day));
  for (const k of MOCK_MONTHS) for (const e of MOCK_ENTRIES) dates.push(date(k, e.day));
  for (let k = -11; k <= 0; k++) dates.push(date(k, PROFIT_DISTRIBUTION.day));
  dates.push(date(LLC_DISTRIBUTION.k, LLC_DISTRIBUTION.day));
  const firstMock = monthIndex(addMonths(m0, -2));
  for (const row of YEARLY_HISTORY) {
    const k = monthIndex({ year: m0.year, month: row.month }) - monthIndex(m0);
    if (monthIndex(addMonths(m0, k)) < firstMock) dates.push(date(k, row.day));
  }
  const plan = planInvestments(5.41);
  for (const d of plan.deposits) dates.push(date(d.k, d.day));
  for (const h of plan.holdings) for (const b of h.buys) dates.push(date(b.k, b.day));
  for (const i of plan.income) dates.push(date(i.k, i.day));
  for (let k = HISTORY_FROM; k <= 0; k++) for (const spec of DAY_TO_DAY) for (const p of dayToDayPurchases(spec, k, 0, today)) dates.push(p.date);
  return dates;
}

/** The next due date after `today` of a monthly rule on `day` (its later occurrences stay unbooked). */
function nextDue(today: string, day: number): string {
  const { m0 } = demoCalendar(today);
  const thisMonth = isoDate(m0, 0, day);
  return thisMonth > today ? thisMonth : isoDate(m0, 1, day);
}

const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

describe("demo seed calendar", () => {
  it("lays the mockup's month so far over the real month so far", () => {
    expect(alignedDay(22, 6)).toBe(6);
    expect(alignedDay(1, 6)).toBe(1);
    expect(alignedDay(16, 6)).toBeLessThanOrEqual(alignedDay(17, 6));
    expect(alignedDay(15, 22)).toBe(15);
    expect(alignedDay(22, 28)).toBe(22);
    expect(alignedDay(25, 23)).toBe(23);
    expect(demoCalendar("2026-10-06").m0).toEqual({ year: 2026, month: 10 });
    // Other months keep the mockup's days.
    expect(demoCalendar("2026-10-06").date(-1, ANCHOR_DAY)).toBe("2026-09-22");
  });

  it.each(["2026-10-06", "2026-10-01", "2026-09-22", "2026-10-30", "2027-02-28", "2026-03-01"])("books nothing after %s", (today) => {
    const late = bookedDates(today).filter((d) => d > today);
    expect(late).toEqual([]);
  });

  it.each(["2026-10-06", "2026-10-01", "2026-09-22", "2026-10-30"])("leaves recurring bills due in the 14 days after %s (Contas fixas)", (today) => {
    const horizon = plusDays(today, 14);
    const upcoming = DEMO_RECURRING.filter((r) => nextDue(today, r.day) <= horizon);
    expect(upcoming.length).toBeGreaterThanOrEqual(2);
  });

  it("books rent, bills and subscriptions every month of the history (the year's heatmap)", () => {
    expect(DEMO_RECURRING.map((r) => r.startK)).toEqual(DEMO_RECURRING.map(() => HISTORY_FROM));
  });
});

describe("demo seed day-to-day spend (mockup MONTHLY)", () => {
  const sum = (xs: { amount: number }[]) => Math.round(xs.reduce((s, x) => s + x.amount, 0) * 100) / 100;

  it("plays the mockup's January..August in M-8..M-1, June..August again before, and September at today's pace in M0", () => {
    expect(dayToDayTarget("mercado", -1, "2026-10-06")).toBe(2310);
    expect(dayToDayTarget("mercado", -8, "2026-10-06")).toBe(1850);
    expect(dayToDayTarget("lazer", -11, "2026-10-06")).toBe(MOCK_MONTHLY.lazer[5]);
    // 6/31 of the month against the mockup's 22/30.
    expect(mockPace("2026-10-06")).toBeCloseTo(6 / 31 / (22 / 30), 6);
    expect(dayToDayTarget("mercado", 0, "2026-10-06")).toBeCloseTo((1640 * 6 * 30) / (31 * 22), 2);
    // From the mockup's own day on, M0 is its September.
    expect(mockPace("2026-09-22")).toBe(1);
    expect(dayToDayTarget("restaurantes", 0, "2026-10-28")).toBe(912);
  });

  it("books only what the month still lacks, inside the month and never after today", () => {
    const today = "2026-10-06";
    for (const spec of DAY_TO_DAY) {
      for (let k = HISTORY_FROM; k <= 0; k++) {
        const target = dayToDayTarget(spec.category, k, today);
        const purchases = dayToDayPurchases(spec, k, 100, today);
        if (target - 100 >= 1) expect(sum(purchases)).toBe(Math.round((target - 100) * 100) / 100);
        else expect(purchases).toEqual([]);
        const { m0 } = demoCalendar(today);
        for (const p of purchases) {
          expect(p.date.slice(0, 7)).toBe(isoDate(m0, k, 1).slice(0, 7));
          expect(p.date <= today).toBe(true);
          expect(p.amount).toBeGreaterThan(0);
        }
      }
    }
    // Already at the target: nothing to book; and reruns plan the same purchases.
    expect(dayToDayPurchases(DAY_TO_DAY[0], -1, 2310, today)).toEqual([]);
    expect(dayToDayPurchases(DAY_TO_DAY[0], -1, 500, today)).toEqual(dayToDayPurchases(DAY_TO_DAY[0], -1, 500, today));
    // A whole month spreads over the month; M0 over the days so far.
    expect(new Set(dayToDayPurchases(DAY_TO_DAY[0], -1, 0, today).map((p) => p.date)).size).toBe(DAY_TO_DAY[0].parts);
  });
});
