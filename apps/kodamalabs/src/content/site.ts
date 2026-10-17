/**
 * Structure of the page that is not copy: what is shown, in which order, and
 * the dated facts that are the same in every locale. Words live in
 * src/messages; facts only the owner has live in ./facts.
 */

/** Merged pull requests listed under "With coding agents", newest first. */
export const MERGED_PULL_REQUESTS = [
  { number: 85, date: '2026-10-10' },
  { number: 67, date: '2026-10-06' },
  { number: 68, date: '2026-10-05' },
  { number: 65, date: '2026-10-04' },
  { number: 57, date: '2026-09-29' },
] as const;

/** Rows of "earlier work" in About, newest first. */
export const EARLIER_WORK = [
  { key: 'closetinn', years: '2017–2019' },
  { key: 'pandora', years: '2015' },
  { key: 'wigic', years: '2015' },
  { key: 'android', years: '2013' },
] as const;
