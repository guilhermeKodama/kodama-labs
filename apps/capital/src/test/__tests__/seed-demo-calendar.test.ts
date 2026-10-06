import { describe, expect, it } from "vitest";
import {
  addMonths,
  alignedDay,
  ANCHOR_DAY,
  DEMO_RECURRING,
  demoCalendar,
  isoDate,
  LLC_DISTRIBUTION,
  MOCK_ENTRIES,
  MOCK_MONTHS,
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
});
