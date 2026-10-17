/** Noon UTC of an ISO day, so formatting never slips to the day before. */
export function isoDay(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

/** First day of an ISO month ("YYYY-MM"), at noon UTC. */
export function isoMonth(month: string): Date {
  return new Date(`${month}-01T12:00:00Z`);
}
