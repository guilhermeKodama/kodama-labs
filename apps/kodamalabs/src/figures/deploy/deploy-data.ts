/**
 * Deploys. Left of the spine, the steps of a deploy; the migration is a
 * proposal until it exits zero. Right of it, the one machine everything runs
 * on. If the migration fails, the path stops at the spine and nothing right of
 * it changes.
 */

/** The steps, by key under `figures.deploy.steps`. The last one is the proposal. */
export const STEPS = ['pull', 'build', 'migrate'] as const;

export const STEP = { top: 57.5, width: 64, height: 26, rx: 5, pitch: 84 } as const;

/** The strand's height: the middle of the steps. */
export const STRAND = 70.5;

/** The services of the machine, as squares in a row, in their groups. */
const SERVICE_GROUPS = [
  { from: 372.5, count: 5 },
  { from: 462.5, count: 5 },
  { from: 552.5, count: 2 },
  { from: 594.5, count: 2 },
  { from: 636.5, count: 1 },
  { from: 662.5, count: 1 },
  { from: 688.5, count: 1 },
  { from: 714.5, count: 4 },
] as const;

export const SERVICE = { y: 64.5, size: 12, pitch: 16 } as const;

/** Left edge of every service, left to right: the order a restart reaches them. */
export const SERVICES: readonly number[] = SERVICE_GROUPS.flatMap((group) =>
  Array.from({ length: group.count }, (_, index) => group.from + index * SERVICE.pitch),
);

/** Each database, and its dev twin beside it. */
export const DATABASES = { y: 128.5, twinOffset: 18, at: [372.5, 420.5, 468.5, 516.5] } as const;

export const MACHINE = {
  left: 'M 366 36.5 L 352.5 36.5 L 352.5 200.5 L 366 200.5',
  right: 'M 778 36.5 L 791.5 36.5 L 791.5 200.5 L 778 200.5',
  tunnelHead: '664,55 668.5,60 673,55',
} as const;

/** What happens when the migration fails: down from the step, and it stops at the spine. */
export const FAILURE = { d: 'M 200.5 84 L 200.5 150.5 L 286 150.5', stop: { x: 287.5, from: 144, to: 157 } } as const;
