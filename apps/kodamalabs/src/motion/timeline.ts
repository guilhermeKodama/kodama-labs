/**
 * Motion as data.
 *
 * A timeline is a list of steps: which element (`k`), which verb, when it
 * starts (`at`, in ms from the moment its figure is triggered) and how long it
 * takes. `bind()` turns a timeline into the attributes each element needs, so
 * figures stay pure server components: the markup carries its own schedule and
 * src/motion/verbs.css plays it. No script runs to draw a frame.
 *
 * Every verb goes from a hidden value to the element's natural value, so the
 * end of a timeline is exactly the static page, and a reader with reduced
 * motion, or without JavaScript, simply gets that static page.
 *
 * The verbs, and what they mean on this page:
 *
 *   rule-x    a ruled line extends from its left end
 *   unfold    a surface or a row is drawn in, left to right
 *   unfold-y  the same, top to bottom
 *   rise      a bar grows from its top edge
 *   arrive    a dashed proposal streams toward its gate and stops short of it
 *   advance   the same at an even pace: time passing, not something sent
 *   ink-x     a solid line is drawn in one stroke: something was committed
 *   ink-y     the same, downward
 *   set       a thing that exists now simply appears, without moving
 *   print     a line of output appears whole, at once
 *   pulse     a running thing blinks once: it restarted
 *   return-x  a loop back across the gate is drawn right to left
 *   wait      a gate shows it is waiting: a hollow ring, for as long as it waits
 *   press     a person decides: the gate is pressed like a button
 *   ripple    the echo of that press
 *   stamp     an evaluator decides: the gate fills in discrete steps
 *   scan      an evaluator reads its candidates one by one (a mark steps down)
 *   check     a check decides: a ring completes one part at a time, then clears
 */

export const EASE = {
  /** Fast start, long settle: a ruler pulled across the sheet. */
  draft: 'var(--m-draft)',
  /** Deliberate start, long settle: a line being inked. */
  ink: 'var(--m-ink)',
  out: 'ease-out',
  inOut: 'ease-in-out',
  linear: 'linear',
} as const;

interface VerbSpec {
  keyframes: string;
  /** Default duration in ms. */
  duration: number;
  ease: string;
  /**
   * `both`: hidden until it starts, natural once it ends.
   * `none`: has an effect only while it runs.
   */
  fill: 'both' | 'none';
  /** `transform-origin` of the element while it is animated. */
  origin?: string;
  /** The dashes of the element's strands also flow while it runs. */
  flow?: boolean;
  /** A mark that exists only while the verb runs (the element is `m-transient`). */
  transient?: boolean;
  /** The accent moving. Only a gate may do this. */
  gateOnly?: boolean;
  /** For a verb that decides: the fraction of its duration at which it has. */
  decidesAt?: number;
}

export const VERBS = {
  'rule-x': { keyframes: 'm-grow-x', duration: 380, ease: EASE.draft, fill: 'both', origin: 'left center' },
  unfold: { keyframes: 'm-wipe-x', duration: 420, ease: EASE.draft, fill: 'both' },
  'unfold-y': { keyframes: 'm-wipe-y', duration: 420, ease: EASE.draft, fill: 'both' },
  rise: { keyframes: 'm-grow-y', duration: 380, ease: EASE.draft, fill: 'both', origin: 'center top' },
  arrive: { keyframes: 'm-wipe-x', duration: 600, ease: EASE.draft, fill: 'both', flow: true },
  advance: { keyframes: 'm-wipe-x', duration: 900, ease: EASE.linear, fill: 'both', flow: true },
  'ink-x': { keyframes: 'm-wipe-x', duration: 520, ease: EASE.ink, fill: 'both' },
  'ink-y': { keyframes: 'm-grow-y', duration: 520, ease: EASE.ink, fill: 'both', origin: 'center top' },
  set: { keyframes: 'm-set', duration: 160, ease: EASE.out, fill: 'both' },
  print: { keyframes: 'm-set', duration: 60, ease: 'steps(1, end)', fill: 'both' },
  pulse: { keyframes: 'm-pulse', duration: 260, ease: EASE.inOut, fill: 'none' },
  'return-x': { keyframes: 'm-wipe-back', duration: 600, ease: EASE.ink, fill: 'both' },
  wait: { keyframes: 'm-wait', duration: 240, ease: EASE.linear, fill: 'none', transient: true, gateOnly: true },
  press: { keyframes: 'm-press', duration: 180, ease: EASE.inOut, fill: 'none', gateOnly: true, decidesAt: 0.45 },
  ripple: { keyframes: 'm-ripple', duration: 420, ease: EASE.out, fill: 'none', transient: true, gateOnly: true },
  stamp: { keyframes: 'm-wipe-y', duration: 400, ease: 'steps(5, start)', fill: 'both', gateOnly: true, decidesAt: 1 },
  scan: { keyframes: 'm-scan', duration: 700, ease: 'steps(5, jump-none)', fill: 'none', transient: true, gateOnly: true, decidesAt: 0.4 },
  check: { keyframes: 'm-check', duration: 440, ease: EASE.linear, fill: 'none', transient: true, gateOnly: true, decidesAt: 0.75 },
} as const satisfies Record<string, VerbSpec>;

export type Verb = keyof typeof VERBS;

export function verbSpec(verb: Verb): VerbSpec {
  return VERBS[verb];
}

/** Which side of the gate a step is on. The tests check the order of the story. */
export type Side = 'proposed' | 'gate' | 'committed';

export interface Step {
  /** Key of the element, unique within the figure. */
  k: string;
  verb: Verb;
  /** Start, in ms from the trigger. */
  at: number;
  /** Duration in ms; the verb's own when omitted. */
  d?: number;
  /** The proposal → gate → commit story this step belongs to (a lane, a path). */
  story?: string;
  /** Its side of the gate in that story. */
  side?: Side;
}

export interface Timeline {
  /** The `data-fig` of the element this timeline plays in. */
  id: string;
  steps: readonly Step[];
}

export function stepDuration(step: Step): number {
  return step.d ?? VERBS[step.verb].duration;
}

export function stepEnd(step: Step): number {
  return step.at + stepDuration(step);
}

/** When a deciding step has decided; undefined for every other step. */
export function decidedAt(step: Step): number | undefined {
  const fraction = verbSpec(step.verb).decidesAt;
  return fraction === undefined ? undefined : step.at + stepDuration(step) * fraction;
}

/** When the last step of a timeline ends. */
export function timelineDuration(timeline: Timeline): number {
  return Math.max(...timeline.steps.map(stepEnd));
}

export function timelineKeys(timeline: Timeline): string[] {
  return [...new Set(timeline.steps.map((step) => step.k))];
}

function shorthand(step: Step, keyframes: string): string {
  const verb = verbSpec(step.verb);
  return `${keyframes} ${stepDuration(step)}ms ${verb.ease} ${step.at}ms ${verb.fill}`;
}

/** The attributes an element needs to take part in its figure's timeline. */
export interface MotionProps {
  'data-k': string;
  style: React.CSSProperties;
}

/**
 * Returns `m(key)`, which gives the element with that key its schedule as CSS
 * custom properties. Asking for a key the timeline does not have throws, so a
 * typo fails at render (and in the tests) instead of silently not moving.
 */
export function bind(timeline: Timeline): (key: string) => MotionProps {
  const byKey = new Map<string, Step[]>();
  for (const step of timeline.steps) {
    byKey.set(step.k, [...(byKey.get(step.k) ?? []), step]);
  }

  return (key) => {
    const steps = byKey.get(key);
    if (!steps) throw new Error(`Timeline "${timeline.id}" has no step for "${key}".`);

    const style: Record<string, string> = {
      '--m': steps.map((step) => shorthand(step, VERBS[step.verb].keyframes)).join(', '),
    };
    const flowing = steps.filter((step) => verbSpec(step.verb).flow);
    if (flowing.length > 0) style['--flow'] = flowing.map((step) => shorthand(step, 'm-flow')).join(', ');
    const origin = steps.map((step) => verbSpec(step.verb).origin).find(Boolean);
    if (origin) style['--o'] = origin;

    return { 'data-k': key, style: style as React.CSSProperties };
  };
}

/** The attributes of the element a timeline plays in. */
export interface ScopeProps {
  'data-fig': string;
  'data-state': 'idle';
  'data-with'?: string;
  suppressHydrationWarning: true;
}

/**
 * Every figure is rendered waiting (`idle`); scripts move it on from there, so
 * React must not complain that the attribute changed before it hydrated.
 * `follows` makes it start together with another figure instead of on its own.
 */
export function scope(timeline: Timeline, follows?: Timeline): ScopeProps {
  return {
    'data-fig': timeline.id,
    'data-state': 'idle',
    ...(follows ? { 'data-with': follows.id } : {}),
    suppressHydrationWarning: true,
  };
}
