/**
 * "Liberdade financeira" as the cross-section of a trunk (the design canvas,
 * boards CerneFire / CerneFireCard). Pure: no React, no fetching.
 *
 * - The trunk's AREA is the invested net worth: r = R·√(value / scale), and
 *   the dashed outer circle is the FIRE number.
 * - The cerne (core) is the first year with money invested, as it closed
 *   (the first month, when that year is this one).
 * - One ring per calendar year after it, from the previous December to
 *   December. A year that lost value still gets a thin ring: a trunk never
 *   shrinks, and a thin ring is how a tree records a bad year.
 * - The year in progress is an arc that closes as the year passes.
 * - Future rings are the December values of the deterministic projection,
 *   dashed, up to the year the FIRE number is reached.
 *
 * Past rings are in the money of their time (the Carteira's history, which
 * is nominal); future rings are in today's money (the engine works in real
 * terms). They meet today, at the FIRE base's current value.
 */
import type { FireSummaryResponse } from "@capital/server/modules/fire/validations/fire";
import {
  MC_SEED,
  MC_TRIALS,
  milestoneThreshold,
  monthsToFirePhased,
  projectFireDate,
  runMonteCarlo,
  toMonthlyRate,
  type FireAssumptions,
  type MilestoneContext,
  type MilestoneDef,
} from "@/lib/fire";
import { buildAssumptions } from "@/lib/fire/adapter";

/** The drawing's viewBox (square) and the trunk's geometry in its units. */
export const TRUNK = {
  size: 600,
  center: 300,
  /** Radius of the target circle (the FIRE number). */
  radius: 260,
  /** How far the core sits from the center, to the lower left: the eccentric rings of the logo. */
  driftX: 18,
  driftY: 14,
  /** Thinnest ring drawn, so a flat or losing year still shows. */
  minRing: 1.5,
  /** From this radius the core holds its name, value and year, so the ray leaves its year out. */
  coreTextMinR: 60,
} as const;

/** A month of the portfolio history (GET /api/v2/portfolio/history). */
export interface HistoryPoint {
  /** "YYYY-MM" */
  period: string;
  netWorth: number;
  contributed: number;
  estimated: boolean;
}

/** A point of the deterministic projection (FIRE summary), months from today. */
export interface ProjectionPoint {
  monthIndex: number;
  investedValue: number;
  contributionsToDate: number;
  growthToDate: number;
}

export interface YearRing {
  year: number;
  /** Value where the ring ends: December of its year, or today for the year in progress. */
  value: number;
  /** Money put in during the ring. */
  aportes: number;
  /** What the money earned (or lost) during the ring: the change in value minus the aportes. */
  rendimento: number;
  /** A month of the ring was valued at cost, before monthly snapshots with prices existed. */
  estimated: boolean;
}

export interface RingHistory {
  core: { year: number; month: number; value: number } | null;
  past: YearRing[];
  /** The year in progress, ending today; `fraction` is how much of the year has gone. */
  current: (YearRing & { fraction: number }) | null;
}

function parsePeriod(period: string): { year: number; month: number } {
  const [year, month] = period.split("-").map(Number);
  return { year, month };
}

/** How much of the calendar year has gone by `now`, 0..1. */
export function yearFraction(now: Date): number {
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  return Math.min(1, (now.getMonth() + now.getDate() / daysInMonth) / 12);
}

/**
 * The core and one ring per calendar year from the history, plus the ring
 * of the year in progress ending at `currentInvested` (the FIRE base today).
 */
export function ringHistory(months: HistoryPoint[], currentInvested: number, now: Date): RingHistory {
  const sorted = [...months].sort((a, b) => a.period.localeCompare(b.period));
  const start = sorted.findIndex((month) => month.netWorth > 0);
  const nowYear = now.getFullYear();
  if (start < 0) {
    // Nothing invested in the history: today's value, if any, is the core.
    return {
      core: currentInvested > 0 ? { year: nowYear, month: now.getMonth() + 1, value: currentInvested } : null,
      past: [],
      current: null,
    };
  }
  const first = sorted[start];
  const { year: coreYear, month: coreMonth } = parsePeriod(first.period);
  const after = sorted.slice(start + 1);
  const inYear = (year: number) => after.filter((month) => parsePeriod(month.period).year === year);

  // The core is its year as it closed; this year's core is its first month, and today closes the ring around it.
  const coreEnd = coreYear < nowYear ? (inYear(coreYear).at(-1) ?? first) : first;
  let prev = { value: coreEnd.netWorth, contributed: coreEnd.contributed };
  const past: YearRing[] = [];
  for (let year = coreYear + 1; year < nowYear; year++) {
    const months = inYear(year);
    if (months.length === 0) continue;
    const end = months[months.length - 1];
    const aportes = end.contributed - prev.contributed;
    past.push({
      year,
      value: end.netWorth,
      aportes,
      rendimento: end.netWorth - prev.value - aportes,
      estimated: months.some((month) => month.estimated),
    });
    prev = { value: end.netWorth, contributed: end.contributed };
  }

  const thisYear = inYear(nowYear);
  // The core is this month: there is no ring yet, only the core.
  const core = { year: coreYear, month: coreMonth, value: coreEnd.netWorth };
  if (coreYear === nowYear && thisYear.length === 0) return { core, past, current: null };
  const contributedNow = thisYear.at(-1)?.contributed ?? prev.contributed;
  const aportes = contributedNow - prev.contributed;
  return {
    core,
    past,
    current: {
      year: nowYear,
      value: currentInvested,
      aportes,
      rendimento: currentInvested - prev.value - aportes,
      estimated: thisYear.some((month) => month.estimated),
      fraction: yearFraction(now),
    },
  };
}

/** The projection at `monthIndex` months from today, linearly between its points. */
export function projectionAt(points: ProjectionPoint[], monthIndex: number): { value: number; contributed: number } {
  const first = points[0];
  const read = (p: ProjectionPoint) => ({ value: p.investedValue, contributed: p.contributionsToDate });
  if (monthIndex <= first.monthIndex) return read(first);
  for (let i = 1; i < points.length; i++) {
    const b = points[i];
    if (b.monthIndex < monthIndex) continue;
    const a = points[i - 1];
    const t = (monthIndex - a.monthIndex) / (b.monthIndex - a.monthIndex);
    return {
      value: a.investedValue + t * (b.investedValue - a.investedValue),
      contributed: a.contributionsToDate + t * (b.contributionsToDate - a.contributionsToDate),
    };
  }
  return read(points[points.length - 1]);
}

/** Years drawn when the FIRE number is never reached at the current pace. */
export const UNREACHABLE_YEARS = 10;
/** Most future rings drawn when it is reached. */
export const MAX_FUTURE_YEARS = 40;

/**
 * December values of the projection, starting with this year's December
 * (the expected close of the ring in progress), until the first one that
 * reaches `target`; ten years when it is never reached.
 */
export function projectedRings(points: ProjectionPoint[], now: Date, target: number, reachable: boolean): YearRing[] {
  if (points.length === 0) return [];
  const sorted = [...points].sort((a, b) => a.monthIndex - b.monthIndex);
  const toDecember = 11 - now.getMonth();
  const limit = reachable ? MAX_FUTURE_YEARS : UNREACHABLE_YEARS;
  const rings: YearRing[] = [];
  let prev = projectionAt(sorted, 0);
  for (let k = 0; k <= limit; k++) {
    const at = projectionAt(sorted, toDecember + 12 * k);
    const aportes = at.contributed - prev.contributed;
    rings.push({ year: now.getFullYear() + k, value: at.value, aportes, rendimento: at.value - prev.value - aportes, estimated: false });
    prev = at;
    if (reachable && target > 0 && at.value >= target) break;
  }
  return rings;
}

// ---------------------------------------------------------------------------
// Geometry (viewBox units)
// ---------------------------------------------------------------------------

/** Radius whose disc has `value / scale` of the target disc's area. */
export function ringRadius(value: number, scale: number): number {
  if (scale <= 0) return 0;
  return TRUNK.radius * Math.sqrt(Math.max(0, value) / scale);
}

/** Center of the ring of radius `r`: the smaller the ring, the further down-left. */
export function ringCenter(r: number): { cx: number; cy: number } {
  const k = 1 - r / TRUNK.radius;
  return { cx: TRUNK.center - TRUNK.driftX * k, cy: TRUNK.center + TRUNK.driftY * k };
}

/** Where the horizontal line y = `y` meets the right side of ring `r`. */
export function coreX(r: number, y: number): number {
  const { cx, cy } = ringCenter(r);
  const dy = y - cy;
  return cx + Math.sqrt(Math.max(0, r * r - dy * dy));
}

const n = (value: number) => Number(value.toFixed(2));

/**
 * The year in progress as a ring segment between two eccentric circles,
 * from twelve o'clock clockwise through `fraction` of the turn.
 */
export function arcPath(inner: number, outer: number, fraction: number): string {
  const f = Math.min(Math.max(fraction, 0.001), 0.999);
  const theta = 2 * Math.PI * f;
  const large = f > 0.5 ? 1 : 0;
  const o = ringCenter(outer);
  const i = ringCenter(inner);
  const point = (c: { cx: number; cy: number }, r: number, angle: number) => `${n(c.cx + r * Math.sin(angle))} ${n(c.cy - r * Math.cos(angle))}`;
  return [
    `M${point(o, outer, 0)}`,
    `A${n(outer)} ${n(outer)} 0 ${large} 1 ${point(o, outer, theta)}`,
    `L${point(i, inner, theta)}`,
    `A${n(inner)} ${n(inner)} 0 ${large} 0 ${point(i, inner, 0)}`,
    "Z",
  ].join(" ");
}

export interface DrawnRing extends YearRing {
  r: number;
  cx: number;
  cy: number;
}

export interface TrunkLabel {
  text: string;
  /** Position on the core line, in viewBox units. */
  x: number;
  kind: "core" | "now" | "year" | "arrival";
}

export interface Trunk {
  scale: number;
  core: { year: number; month: number; value: number; r: number; cx: number; cy: number } | null;
  past: DrawnRing[];
  current: (DrawnRing & { fraction: number; inner: number; path: string }) | null;
  future: DrawnRing[];
  /** The target circle; null without a FIRE number. */
  target: { r: number; value: number } | null;
  /** The horizontal line labels and milestones sit on. */
  lineY: number;
  labels: TrunkLabel[];
}

/** Every number the drawing needs. Radii never shrink from one ring to the next. */
export function buildTrunk(history: RingHistory, future: YearRing[], target: number | null, arrivalYear: number | null): Trunk {
  // The target is the outer circle; only what was already reached can be bigger (the projection stops at it).
  const values = [history.core?.value ?? 0, ...history.past.map((ring) => ring.value), history.current?.value ?? 0];
  const scale = Math.max(target ?? 0, ...values);
  let last = 0;
  const grow = (value: number, solid: boolean) => {
    const r = Math.max(ringRadius(value, scale), solid && last > 0 ? last + TRUNK.minRing : last);
    last = r;
    return r;
  };
  const drawn = (ring: YearRing, solid: boolean): DrawnRing => {
    const r = grow(ring.value, solid);
    return { ...ring, r, ...ringCenter(r) };
  };

  const coreR = history.core ? grow(history.core.value, true) : 0;
  const core = history.core ? { ...history.core, r: coreR, ...ringCenter(coreR) } : null;
  const past = history.past.map((ring) => drawn(ring, true));
  const inner = last;
  const current = history.current ? (() => {
    const ring = drawn(history.current, true);
    return { ...ring, fraction: history.current.fraction, inner, path: arcPath(inner, ring.r, history.current.fraction) };
  })() : null;
  const futureRings = future.filter((ring) => !current || ring.year >= current.year).map((ring) => drawn(ring, false));
  const targetCircle = target && target > 0 ? { r: ringRadius(target, scale), value: target } : null;

  // The ray runs right from the core along the trunk's horizontal axis.
  const lineY = TRUNK.center;
  const candidates: (TrunkLabel & { priority: number })[] = [];
  if (core && core.r < TRUNK.coreTextMinR) candidates.push({ text: String(core.year), x: coreX(core.r, lineY), kind: "core", priority: 2 });
  if (current) candidates.push({ text: "", x: coreX(current.r, lineY), kind: "now", priority: 0 });
  if (targetCircle && arrivalYear !== null) candidates.push({ text: String(arrivalYear), x: coreX(targetCircle.r, lineY), kind: "arrival", priority: 1 });
  for (const ring of [...past, ...futureRings]) {
    if (ring.year % 5 === 0 && ring.year !== arrivalYear && ring.year !== current?.year) {
      candidates.push({ text: String(ring.year), x: coreX(ring.r, lineY), kind: "year", priority: 3 });
    }
  }
  const labels: TrunkLabel[] = [];
  for (const label of candidates.sort((a, b) => a.priority - b.priority)) {
    if (labels.every((kept) => Math.abs(kept.x - label.x) >= 30)) labels.push({ text: label.text, x: label.x, kind: label.kind });
  }
  labels.sort((a, b) => a.x - b.x);

  return { scale, core, past, current, future: futureRings, target: targetCircle, lineY, labels };
}

// ---------------------------------------------------------------------------
// Milestones, what-if and the arrival range
// ---------------------------------------------------------------------------

export interface MilestoneMark {
  id: string;
  name: string;
  type: MilestoneDef["type"];
  value: number;
  /** Net worth it needs; null for an age milestone. */
  threshold: number | null;
  reached: boolean;
  /** The year it was or will be reached; null when the drawn years never reach it. */
  year: number | null;
}

/**
 * Each milestone with the year it was reached (the first ring that ends at
 * or above it) or will be (the first projected December). `rings` are the
 * past, current and future rings in order; `coreYear` answers the ones the
 * core itself already passed.
 */
export function milestoneMarks(defs: MilestoneDef[], ctx: MilestoneContext, rings: YearRing[], coreYear: number | null, nowYear: number): MilestoneMark[] {
  return defs.map((def) => {
    if (def.type === "age") {
      // Without the user's age (NaN) an age milestone has no year.
      const known = Number.isFinite(ctx.currentAge);
      return {
        id: def.id,
        name: def.name,
        type: def.type,
        value: def.value,
        threshold: null,
        reached: known && ctx.currentAge >= def.value,
        year: known ? nowYear + Math.max(0, Math.ceil(def.value - ctx.currentAge)) : null,
      };
    }
    const threshold = milestoneThreshold(def, ctx);
    const reached = ctx.currentInvested >= threshold;
    const ring = rings.find((r) => r.value >= threshold);
    return { id: def.id, name: def.name, type: def.type, value: def.value, threshold, reached, year: ring?.year ?? (reached ? coreYear : null) };
  });
}

/** The year the FIRE number is reached contributing `monthly` from now on (the server's altProjection). */
export function whatIfArrival(currentInvested: number, fireNumber: number, realAnnualReturn: number, monthly: number, now: Date): number | null {
  const months = monthsToFirePhased(currentInvested, [{ fromMonth: 0, toMonth: null, monthlyContribution: monthly }], toMonthlyRate(realAnnualReturn), fireNumber);
  return projectFireDate(now, months)?.getFullYear() ?? null;
}

/**
 * The years between which the FIRE number is reached in 80% of the market
 * scenarios: the first year the 90th percentile reaches it, and the first
 * the 10th does (null when that never happens within the horizon). Only the
 * accumulation is simulated: no trial starts withdrawing.
 */
export function arrivalRange(
  a: FireAssumptions,
  fireNumber: number,
  opts: { currentAge: number | null; lifeExpectancyAge: number; annualVolatility: number },
  now: Date,
): { from: number; to: number | null } | null {
  if (opts.currentAge === null || opts.lifeExpectancyAge <= opts.currentAge || fireNumber <= 0) return null;
  const horizon = Math.ceil((opts.lifeExpectancyAge - opts.currentAge) * 12);
  const mc = runMonteCarlo(
    { ...a, withdrawalStrategy: "perpetuity" },
    {
      currentAge: opts.currentAge,
      lifeExpectancyAge: opts.lifeExpectancyAge,
      annualVolatility: opts.annualVolatility,
      trials: MC_TRIALS,
      seed: MC_SEED,
      retirementMonthIndex: horizon + 12,
    },
  );
  const early = mc.points.find((point) => point.p90 >= fireNumber);
  if (!early) return null;
  const late = mc.points.find((point) => point.p10 >= fireNumber);
  return { from: now.getFullYear() + early.yearOffset, to: late ? now.getFullYear() + late.yearOffset : null };
}

// ---------------------------------------------------------------------------
// The screen's view model
// ---------------------------------------------------------------------------

export interface FireRingsView {
  /** The FIRE base today ("Sua árvore hoje"). */
  currentInvested: number;
  /** Null without a plan. */
  plan: {
    fireNumber: number;
    progress: number;
    reached: boolean;
    targetMonthlyIncome: number;
    safeWithdrawalRate: number;
    passiveIncome: number;
    realAnnualReturn: number;
    /** The plan's contribution this month. */
    contribution: number | null;
    /** The year the plan reaches the FIRE number; null when it never does. */
    arrivalYear: number | null;
    assumptions: FireAssumptions;
    currentAge: number | null;
    lifeExpectancyAge: number;
    annualVolatility: number;
  } | null;
  history: RingHistory;
  future: YearRing[];
  trunk: Trunk;
  milestones: MilestoneMark[];
}

/**
 * Everything the Liberdade financeira screen and the Aportes card draw,
 * from the FIRE summary and the Carteira's monthly history. The phases are
 * the ones the summary projected with: the solved ones for a plan by date.
 */
export function fireRingsView(summary: FireSummaryResponse, months: HistoryPoint[], now: Date): FireRingsView {
  const { goal, result } = summary;
  const currentInvested = result?.currentInvested ?? summary.suggestedDefaults.currentInvested;
  const history = ringHistory(months, currentInvested, now);
  if (!goal || !result) {
    return { currentInvested, plan: null, history, future: [], trunk: buildTrunk(history, [], null, null), milestones: [] };
  }

  const reachable = result.reached || result.projectedFireDate !== null;
  const arrivalYear = result.projectedFireDate ? Number(result.projectedFireDate.slice(0, 4)) : null;
  const future = projectedRings(summary.projection?.points ?? [], now, result.fireNumber, reachable);
  const trunk = buildTrunk(history, future, result.fireNumber, result.reached ? null : arrivalYear);
  const phases = goal.planningMode === "by_date" && summary.requiredContribution ? summary.requiredContribution.phases : goal.phases;
  const assumptions = buildAssumptions(
    {
      targetMonthlyIncome: goal.targetMonthlyIncome,
      safeWithdrawalRate: goal.safeWithdrawalRate,
      nominalAnnualReturn: goal.nominalAnnualReturn,
      annualInflation: goal.annualInflation,
      monthlyIncome: goal.monthlyIncome,
      phases,
      withdrawalStrategy: goal.withdrawalStrategy === "depletion" ? "depletion" : "perpetuity",
    },
    currentInvested,
  );
  const rings = [...history.past, ...(history.current ? [history.current] : []), ...future.filter((ring) => ring.year > now.getFullYear())];
  const milestones = milestoneMarks(
    goal.milestones,
    {
      annualExpenses: goal.targetMonthlyIncome * 12,
      swr: goal.safeWithdrawalRate,
      currentInvested,
      fireNumber: result.fireNumber,
      monthlyRealReturn: toMonthlyRate(result.realAnnualReturn),
      retirementMonthIndex: result.retirementMonthIndex,
      currentAge: goal.currentAge ?? Number.NaN,
    },
    rings,
    history.core?.year ?? null,
    now.getFullYear(),
  );

  return {
    currentInvested,
    plan: {
      fireNumber: result.fireNumber,
      progress: result.progress,
      reached: result.reached,
      targetMonthlyIncome: goal.targetMonthlyIncome,
      safeWithdrawalRate: goal.safeWithdrawalRate,
      passiveIncome: result.currentMonthlyPassiveIncome,
      realAnnualReturn: result.realAnnualReturn,
      contribution: summary.currentMonthContribution,
      arrivalYear,
      assumptions,
      currentAge: goal.currentAge,
      lifeExpectancyAge: goal.lifeExpectancyAge,
      annualVolatility: goal.annualVolatility,
    },
    history,
    future,
    trunk,
    milestones,
  };
}
