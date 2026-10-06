/** Share of the credit limit the open statement uses, for the card usage bar (0 when there is no limit). */
export function limitShare(total: number, creditLimit: number | null | undefined): number {
  if (!creditLimit || creditLimit <= 0 || !Number.isFinite(total)) return 0;
  return Math.max(0, total) / creditLimit;
}

/** A day-of-month field (closing or due day): 1–31, or null when blank or invalid. */
export function parseDay(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,2}$/.test(trimmed)) return null;
  const day = Number(trimmed);
  return day >= 1 && day <= 31 ? day : null;
}
