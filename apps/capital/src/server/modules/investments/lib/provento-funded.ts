/**
 * Which brokerage-cash purchases count as aporte.
 *
 * Líquido is new money that entered investments from outside (a transfer
 * into a broker), plus a purchase paid with cash that arrived inside the
 * broker as provento (dividend, JCP, FII rendimento, yield), minus
 * withdrawals. The provento itself is not an aporte: it counts only when
 * it is spent on a purchase, in the month of that purchase.
 *
 * Cash is fungible, so each broker keeps two pools, walked in date order:
 * - external: transfers in and sale proceeds (already an aporte, or the
 *   recycling of one);
 * - income: proventos credited to that broker and not yet spent or taken out.
 *
 * A purchase linked to the transfer that paid for it (fundingGroupId)
 * spends external cash only, so the transfer is not counted a second time.
 * Any other purchase spends income cash first: that slice is the aporte.
 * The rest spends external cash and adds nothing. A withdrawal spends
 * external cash first and income cash after, and adds nothing here (the
 * caller already subtracts the whole withdrawal).
 */

export type AporteCashKind = "income" | "deposit" | "sale" | "purchase" | "withdrawal";

export interface AporteCashEvent {
  id: string;
  /** Brokerage account whose cash moved. Pools never cross accounts. */
  accountId: string;
  /** Calendar day, "YYYY-MM-DD". */
  date: string;
  /** Positive amount in the base currency. */
  amount: number;
  kind: AporteCashKind;
  /**
   * Purchases only: how much of `amount` was paid by a transfer booked for
   * this buy. That slice already counts as the transfer and must not also
   * consume provento cash.
   */
  funded?: number;
  /** Purchases only: ticker or holding name, shown as the origin. */
  label?: string;
  entityId?: string;
}

export interface ProventoFundedPurchase {
  id: string;
  accountId: string;
  entityId: string | null;
  date: string;
  /** "YYYY-MM" of the purchase, which is when the aporte counts. */
  period: string;
  amount: number;
  label: string;
}

const KIND_ORDER: Record<AporteCashKind, number> = {
  // Same-day inflows land before a purchase, and a purchase before a withdrawal.
  income: 0,
  deposit: 1,
  sale: 2,
  purchase: 3,
  withdrawal: 4,
};

const cents = (amount: number) => Math.round(amount * 100);

interface Pool {
  income: number;
  external: number;
}

/**
 * The part of each purchase paid with provento cash still at the broker.
 * One provento funds a purchase at most once: a later purchase sees what
 * is left. Events for different accounts do not share a pool.
 */
export function proventoFundedPurchases(events: readonly AporteCashEvent[]): ProventoFundedPurchase[] {
  const sorted = [...events].sort(
    (a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || a.id.localeCompare(b.id),
  );
  const pools = new Map<string, Pool>();
  const poolOf = (accountId: string): Pool => {
    let pool = pools.get(accountId);
    if (!pool) {
      pool = { income: 0, external: 0 };
      pools.set(accountId, pool);
    }
    return pool;
  };
  const out: ProventoFundedPurchase[] = [];
  for (const event of sorted) {
    const amount = cents(event.amount);
    if (amount <= 0) continue;
    const pool = poolOf(event.accountId);
    if (event.kind === "income") {
      pool.income += amount;
      continue;
    }
    if (event.kind === "deposit" || event.kind === "sale") {
      pool.external += amount;
      continue;
    }
    if (event.kind === "withdrawal") {
      const fromExternal = Math.min(pool.external, amount);
      pool.external -= fromExternal;
      pool.income -= Math.min(pool.income, amount - fromExternal);
      continue;
    }
    const funded = Math.min(Math.max(cents(event.funded ?? 0), 0), amount);
    // The funded slice is the transfer's money even when that cash is not
    // still sitting in the external pool (it was booked for this buy).
    pool.external -= Math.min(pool.external, funded);
    let rest = amount - funded;
    const fromIncome = Math.min(pool.income, rest);
    pool.income -= fromIncome;
    rest -= fromIncome;
    pool.external -= Math.min(pool.external, rest);
    if (fromIncome <= 0) continue;
    out.push({
      id: event.id,
      accountId: event.accountId,
      entityId: event.entityId ?? null,
      date: event.date,
      period: event.date.slice(0, 7),
      amount: fromIncome / 100,
      label: event.label?.trim() || event.accountId,
    });
  }
  return out;
}
