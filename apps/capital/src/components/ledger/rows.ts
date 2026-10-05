import type { LedgerRow } from "@capital/server/modules/ledger/contracts";

/**
 * A display row. With transfers as one line, both legs collapse into the
 * outflow leg, carrying the destination account and the absolute amount.
 */
export interface DisplayRow extends LedgerRow {
  legIds: string[];
  toAccountId: string | null;
  neutral: boolean;
}

export function toDisplayRows(rows: LedgerRow[], mode: "group" | "legs"): DisplayRow[] {
  const plain = (row: LedgerRow): DisplayRow => ({ ...row, legIds: [row.id], toAccountId: null, neutral: false });
  if (mode === "legs") return rows.map(plain);
  const byGroup = new Map<string, LedgerRow[]>();
  for (const row of rows) {
    if (row.transferGroupId) byGroup.set(row.transferGroupId, [...(byGroup.get(row.transferGroupId) ?? []), row]);
  }
  const out: DisplayRow[] = [];
  const done = new Set<string>();
  for (const row of rows) {
    if (!row.transferGroupId) {
      out.push(plain(row));
      continue;
    }
    if (done.has(row.transferGroupId)) continue;
    const legs = byGroup.get(row.transferGroupId) ?? [row];
    if (legs.length < 2) {
      // Only one leg is in view (e.g. filtered by entity): it is a real in/out flow here.
      out.push(plain(row));
      continue;
    }
    done.add(row.transferGroupId);
    const from = legs.find((leg) => leg.amount < 0) ?? legs[0];
    const to = legs.find((leg) => leg.id !== from.id) ?? legs[1];
    out.push({ ...from, legIds: legs.map((leg) => leg.id), toAccountId: to.accountId, neutral: true, amountBase: Math.abs(from.amountBase) });
  }
  return out;
}

export function selectionStats(rows: DisplayRow[]) {
  const values = rows.filter((row) => !row.neutral).map((row) => row.amountBase);
  const sum = values.reduce((s, v) => s + v, 0);
  return {
    count: rows.length,
    sum,
    avg: values.length ? sum / values.length : 0,
    min: values.length ? Math.min(...values) : 0,
    max: values.length ? Math.max(...values) : 0,
  };
}
