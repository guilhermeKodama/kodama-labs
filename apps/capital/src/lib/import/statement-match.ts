import type { FieldDiff } from "@capital/server/modules/bank-statements/services/reconciliation";

/**
 * Re-importing a card bill: which rows of the file the statement already
 * has, which of them changed (an open bill imported, then the closed one
 * with the purchase's final date, amount or merchant name) and which rows
 * of the statement left it. Pure: the import analysis and the commit's
 * safety net (import-card-statement.ts) both run it over the same inputs.
 *
 * Matching is one to one, in passes (each pass over every file row before
 * the next one starts):
 * 1. the same external id (the OFX FITID) anywhere on the card: duplicate,
 *    or changed with the fields that differ;
 * 2. the same identity (date, amount, description, installment) on the
 *    statement or on the one a month before or after (a purchase that
 *    changed cycle): duplicate;
 * 3. close enough, against every live row of the statement, imported ones
 *    included: same installment number, date within 3 days, amount within
 *    max(R$ 0,05; 1%) (5% when the line looks like a converted foreign
 *    purchase), and a similar merchant name: changed. A row typed by hand
 *    matches on the exact amount and the date alone, whatever its
 *    description, and keeps its description. Only the target statement:
 *    on the next one, the same coffee bought two days apart is another
 *    purchase, not this one moved.
 * Rows of the target statement nothing matched left the bill. They are
 * only reported when the file covers the whole cycle (coversStatementCycle):
 * a partial file never proposes a removal.
 */

/** A row of the file, in the statement convention: a charge is positive, a refund negative. */
export interface StatementFileRow {
  /** Key of the row in the result (the analysis row id). */
  key: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  amount: number;
  installmentNumber?: number | null;
  /** FITID of a card OFX line; null for CSV rows. */
  externalId?: string | null;
}

/** Where a ledger row sits relative to the statement being imported. */
export type LedgerRowScope = "target" | "neighbor" | "elsewhere";

/** A live, booked (not projected) row of the card, in the statement convention. */
export interface StatementLedgerRow {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  amount: number;
  installmentNumber: number | null;
  externalId: string | null;
  /** target: on the statement imported into; neighbor: a month before or after; elsewhere: only reachable by external id. */
  scope: LedgerRowScope;
  /** Typed by hand (no import): its description is the user's and stays. */
  manual?: boolean;
  /** Booked in another currency than the card's. */
  foreign?: boolean;
}

export type StatementMatchBy = "externalId" | "key" | "fuzzy";

export type StatementMatch =
  | { status: "new" }
  | { status: "duplicate"; entryId: string; by: StatementMatchBy }
  | { status: "changed"; entryId: string; by: StatementMatchBy; diffs: FieldDiff[] };

export interface StatementReconciliation {
  /** By file row key. */
  matches: Map<string, StatementMatch>;
  /** Ids of target-statement rows the file no longer has (empty unless the file covers the cycle). */
  removed: string[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const FUZZY_DAYS = 3;
const DUPLICATE_SUFFIX = /~dup\d+$/;

const collapse = (s: string) => s.toLowerCase().trim().replace(/\s+/g, " ");

/** Identity of a statement row (charge > 0): two rows with the same key are the same purchase. */
export const statementRowKey = (date: string, amount: number, description: string, installmentNumber?: number | null) =>
  `${date}|${amount.toFixed(2)}|${collapse(description)}${installmentNumber ? `|${installmentNumber}` : ""}`;

/** An external id booked again on purpose ("<fitid>~dup<n>") is still that line. */
export const baseExternalId = (id: string) => id.replace(DUPLICATE_SUFFIX, "");

/**
 * Merchant name for comparison: no accents, no payment-processor prefix ("IFD*",
 * "PAG*", "MP*"), no installment suffix ("(2/10)", "- Parcela 2/10"), only
 * letters, digits and single spaces.
 */
export function normalizeMerchant(description: string): string {
  return description
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s*-?\s*parcela\s*\d{1,2}\s*(\/|de)\s*\d{1,2}\s*$/, "")
    .replace(/\s*\(?\d{1,2}\s*\/\s*\d{1,2}\)?\s*$/, "")
    .replace(/^\s*(ifd|ifood|pag|pg|mp|ebn|pp|dl|ec)\s?\*\s*/, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const tokens = (s: string) => s.split(" ").filter((t) => t.length >= 3);

/**
 * Whether two descriptions name the same merchant: one is a prefix of the
 * other (letters and digits only, at least 3 of them), or they share a word
 * of 4+ letters, or half the words of the shorter one.
 */
export function similarDescriptions(a: string, b: string): boolean {
  const na = normalizeMerchant(a);
  const nb = normalizeMerchant(b);
  if (!na || !nb) return false;
  const ca = na.replace(/ /g, "");
  const cb = nb.replace(/ /g, "");
  const [short, long] = ca.length <= cb.length ? [ca, cb] : [cb, ca];
  if (short.length >= 3 && long.startsWith(short)) return true;
  const ta = tokens(na);
  const tb = new Set(tokens(nb));
  const shared = ta.filter((t) => tb.has(t));
  if (shared.some((t) => t.length >= 4)) return true;
  const fewest = Math.min(ta.length, tb.size);
  return fewest > 0 && shared.length * 2 >= fewest;
}

/** A purchase converted from another currency (its amount moves with the rate between the open and the closed bill). */
export function looksInternational(description: string): boolean {
  return /\b(usd|us\$|eur|gbp|iof|internacional|international|exterior)\b/i.test(description) || /\b[A-Z]{3}\s?\d+[.,]\d{2}\b/.test(description);
}

/** Same sign and within max(R$ 0,05; 1%), or 5% for a converted purchase. */
export function amountsClose(a: number, b: number, foreign: boolean): boolean {
  if (Math.sign(a) !== Math.sign(b)) return false;
  const tolerance = Math.max(0.05, (foreign ? 0.05 : 0.01) * Math.max(Math.abs(a), Math.abs(b)));
  return Math.abs(a - b) <= tolerance + 1e-9;
}

const dayNumber = (ymd: string) => Date.UTC(Number(ymd.slice(0, 4)), Number(ymd.slice(5, 7)) - 1, Number(ymd.slice(8, 10))) / DAY_MS;

/** "2026-09-05" + 1 → "2026-09-06". */
export function addDays(ymd: string, days: number): string {
  return new Date((dayNumber(ymd) + days) * DAY_MS).toISOString().slice(0, 10);
}

function diffsOf(file: StatementFileRow, row: StatementLedgerRow): FieldDiff[] {
  const diffs: FieldDiff[] = [];
  if (Math.abs(file.amount - row.amount) > 0.001) diffs.push({ field: "amount", existingValue: row.amount.toFixed(2), ofxValue: file.amount.toFixed(2) });
  if (file.date !== row.date) diffs.push({ field: "date", existingValue: row.date, ofxValue: file.date });
  if (!row.manual && file.description.trim() !== row.description.trim()) diffs.push({ field: "description", existingValue: row.description, ofxValue: file.description });
  return diffs;
}

const scopeRank: Record<LedgerRowScope, number> = { target: 0, neighbor: 1, elsewhere: 2 };

export function reconcileStatement(
  fileRows: readonly StatementFileRow[],
  ledgerRows: readonly StatementLedgerRow[],
  opts: { coversCycle: boolean }
): StatementReconciliation {
  const matches = new Map<string, StatementMatch>();
  const used = new Set<string>();
  const nearby = [...ledgerRows].filter((r) => r.scope !== "elsewhere").sort((a, b) => scopeRank[a.scope] - scopeRank[b.scope]);

  const settle = (file: StatementFileRow, row: StatementLedgerRow, by: StatementMatchBy) => {
    used.add(row.id);
    const diffs = diffsOf(file, row);
    matches.set(file.key, diffs.length ? { status: "changed", entryId: row.id, by, diffs } : { status: "duplicate", entryId: row.id, by });
  };

  // 1. Same external id, wherever it sits on the card.
  for (const file of fileRows) {
    if (!file.externalId) continue;
    const id = baseExternalId(file.externalId);
    const row = [...ledgerRows]
      .sort((a, b) => scopeRank[a.scope] - scopeRank[b.scope])
      .find((r) => !used.has(r.id) && r.externalId && baseExternalId(r.externalId) === id);
    if (row) settle(file, row, "externalId");
  }

  // 2. Same identity on the statement or next to it.
  for (const file of fileRows) {
    if (matches.has(file.key)) continue;
    const key = statementRowKey(file.date, file.amount, file.description, file.installmentNumber);
    const row = nearby.find((r) => !used.has(r.id) && statementRowKey(r.date, r.amount, r.description, r.installmentNumber) === key);
    if (row) settle(file, row, "key");
  }

  // 3. Close enough, on the target statement: the best candidate (nearest date and amount).
  for (const file of fileRows) {
    if (matches.has(file.key)) continue;
    const fileDay = dayNumber(file.date);
    let best: { row: StatementLedgerRow; score: number } | null = null;
    for (const row of nearby) {
      if (used.has(row.id) || row.scope !== "target") continue;
      if ((row.installmentNumber ?? null) !== (file.installmentNumber ?? null)) continue;
      const days = Math.abs(dayNumber(row.date) - fileDay);
      if (days > FUZZY_DAYS) continue;
      const exactAmount = Math.abs(row.amount - file.amount) < 0.005;
      const fits = row.manual && exactAmount
        ? true
        : amountsClose(file.amount, row.amount, !!row.foreign || looksInternational(file.description) || looksInternational(row.description)) &&
          similarDescriptions(file.description, row.description);
      if (!fits) continue;
      const score = days + (Math.abs(row.amount - file.amount) / Math.max(Math.abs(file.amount), 0.01)) * 10;
      if (!best || score < best.score) best = { row, score };
    }
    if (best) settle(file, best.row, "fuzzy");
  }

  for (const file of fileRows) if (!matches.has(file.key)) matches.set(file.key, { status: "new" });
  const removed = opts.coversCycle ? ledgerRows.filter((r) => r.scope === "target" && !used.has(r.id)).map((r) => r.id) : [];
  return { matches, removed };
}

/**
 * Whether a bill file covers its statement's whole cycle (only then can a
 * row missing from it have left the bill). An OFX states its range
 * (DTSTART/DTEND): it must start by the day after the previous closing and
 * end by the closing date, a day of slack each way. A CSV only has its
 * rows' dates: the statement must have closed and the file reach the last
 * three days of the cycle.
 */
export function coversStatementCycle(input: {
  /** The file's own range (OFX) or the span of its rows (CSV), YYYY-MM-DD. */
  from: string | null;
  to: string | null;
  /** The range is the file's stated one (OFX DTSTART/DTEND), not inferred from rows. */
  stated: boolean;
  /** First day of the cycle (the day after the previous closing). */
  cycleStart: string;
  closingDate: string;
  /** The user's calendar day. */
  today: string;
}): boolean {
  const { from, to, stated, cycleStart, closingDate, today } = input;
  if (!to) return false;
  if (stated) return !!from && from <= addDays(cycleStart, 1) && to >= addDays(closingDate, -1);
  return closingDate <= today && to >= addDays(closingDate, -3);
}
