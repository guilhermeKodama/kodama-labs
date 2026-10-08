/**
 * Proventos of the last 12 months: dividend and yield operations, plus
 * ledger income in the Proventos category that no operation already took.
 * One operation matches at most one income row (same base amount within
 * R$ 0.01, dates within 7 days).
 */

const DAY = 86_400_000;
const AMOUNT = 0.01;

export interface ProventoCandidate {
  id: string;
  at: number;
  base: number;
}

/** Income rows no dividend or yield operation already counted. */
export function unmatchedProventos(operations: readonly ProventoCandidate[], entries: readonly ProventoCandidate[]): string[] {
  const used = new Set<string>();
  const ops = [...operations].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  const unmatched: string[] = [];
  for (const entry of [...entries].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))) {
    let best: ProventoCandidate | null = null;
    let bestGap = Infinity;
    for (const op of ops) {
      if (used.has(op.id)) continue;
      if (Math.abs(op.base - entry.base) > AMOUNT) continue;
      const gap = Math.abs(op.at - entry.at);
      if (gap > 7 * DAY) continue;
      if (gap < bestGap) {
        bestGap = gap;
        best = op;
      }
    }
    if (best) used.add(best.id);
    else unmatched.push(entry.id);
  }
  return unmatched;
}
