import type { DbClient } from "@capital/server/lib/prisma";
import { LedgerError } from "./errors";

export interface FxContext {
  baseCurrency: string;
  /** Base-currency units per 1 unit of `currency` (1 for the base currency). */
  rateFor(currency: string): number;
}

/**
 * Rates come from the user's currencies table, where `manualRate` means
 * "1 base = X foreign", so the stored entry rate is its inverse. A missing
 * or non-positive rate falls back to 1, matching the pre-ledger behavior.
 */
export async function loadFx(userId: string, db: DbClient): Promise<FxContext> {
  const [user, currencies] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { baseCurrency: true } }),
    db.currency.findMany({ where: { userId }, select: { code: true, manualRate: true } }),
  ]);
  if (!user) throw new LedgerError("User not found", 404, { code: "user.not_found" });
  const rates = new Map(currencies.map((c) => [c.code, c.manualRate]));
  return {
    baseCurrency: user.baseCurrency,
    rateFor(currency: string) {
      if (currency === user.baseCurrency) return 1;
      const manual = rates.get(currency);
      return manual && manual > 0 ? 1 / manual : 1;
    },
  };
}
