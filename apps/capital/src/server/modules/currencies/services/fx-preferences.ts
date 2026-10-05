import type { DbClient } from "@capital/server/lib/prisma";
import type { Locale } from "@capital/server/i18n";
import { autoSourceFor } from "../lib/fx-source";
import { currencyName, currencySymbol } from "../lib/signup-currencies";

/**
 * Turning the automatic FX update on hands every currency but the base
 * back to its automatic source (PTAX or ECB), so the next refresh replaces
 * the rates the user had typed; turning it off labels them all manual,
 * which is what they are from then on. Rates and their dates are kept.
 */
export async function relabelCurrencySources(userId: string, baseCurrency: string, auto: boolean, db: DbClient) {
  const rows = await db.currency.findMany({ where: { userId, code: { not: baseCurrency } }, select: { id: true, code: true, source: true } });
  for (const row of rows) {
    const source = auto ? autoSourceFor(baseCurrency, row.code) : "manual";
    if (row.source !== source) await db.currency.update({ where: { id: row.id }, data: { source } });
  }
}

/**
 * Rates are stored as units of each currency per one unit of the base
 * currency, so a new base divides every rate by the new base's own rate
 * (and the new base becomes 1). Automatic rates switch to the new base's
 * source (PTAX quotes only against BRL); manual ones stay manual. A base the
 * user has no row for is added at rate 1, and the other rates are then left
 * as they are, since nothing converts them; the next refresh replaces the
 * automatic ones.
 */
export async function rebaseCurrencies(userId: string, fromBase: string, toBase: string, db: DbClient, locale: Locale) {
  if (fromBase === toBase) return;
  const rows = await db.currency.findMany({ where: { userId } });
  const target = rows.find((r) => r.code === toBase);
  const factor = target && target.manualRate > 0 ? target.manualRate : null;
  const relabel = (code: string, source: string) => (source === "manual" ? "manual" : autoSourceFor(toBase, code));

  if (!target) {
    await db.currency.create({
      data: { userId, code: toBase, name: currencyName(toBase, locale), symbol: currencySymbol(toBase, locale), manualRate: 1, source: autoSourceFor(toBase, toBase) },
    });
  }
  for (const row of rows) {
    const manualRate = row.code === toBase ? 1 : factor === null ? row.manualRate : (row.code === fromBase ? 1 : row.manualRate) / factor;
    const source = row.code === toBase ? row.source : relabel(row.code, row.source);
    if (manualRate !== row.manualRate || source !== row.source) {
      await db.currency.update({ where: { id: row.id }, data: { manualRate, source } });
    }
  }
  if (factor !== null && !rows.some((r) => r.code === fromBase)) {
    await db.currency.create({
      data: { userId, code: fromBase, name: currencyName(fromBase, locale), symbol: currencySymbol(fromBase, locale), manualRate: 1 / factor, source: autoSourceFor(toBase, fromBase) },
    });
  }
}
