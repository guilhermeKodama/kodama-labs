/**
 * The validation playbook on a time axis. The spine is the verdict at week 4:
 * go, pivot or kill. An idea runs dashed toward it, past three marks.
 */

/** What an idea passes on its way to a verdict, and where on the axis. */
export const MARKS = [
  { key: 'page', x: 0 },
  { key: 'prototype', x: 110 },
  { key: 'traffic', x: 190 },
] as const;

/** Where the dashed line of an idea ends, short of the spine. */
export const IDEA_END = 287;

export const MILHAS = { y: 56 } as const;
export const FIRE = { y: 104, end: 60 } as const;
export const AXIS = { y: 140.5, ticks: [0.5, 110.5] } as const;
