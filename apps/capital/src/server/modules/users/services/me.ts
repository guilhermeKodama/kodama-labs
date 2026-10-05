import type { User } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { resolveLocale, type Locale } from "@capital/server/i18n";
import { rebaseCurrencies, relabelCurrencySources } from "@capital/server/modules/currencies/services/fx-preferences";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { getPersonalEntity, listEntities } from "@capital/server/modules/ledger/services/entities";
import { inTransaction } from "@capital/server/modules/ledger/services/mutations";
import { isDateFormat, isTheme, normalizeNumberFormat } from "../lib/preferences";

export interface PreferencesPatch {
  name?: string;
  baseCurrency?: string;
  theme?: string;
  dateFormat?: string;
  numberFormat?: string;
  timezone?: string;
  /** UI language; names the server writes from now on follow it too. */
  locale?: Locale;
  /** Let the hourly cron refresh the currencies' rates (PTAX / ECB). */
  fxAutoUpdate?: boolean;
}

export function serializeUser(user: User) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    baseCurrency: user.baseCurrency,
    theme: user.theme,
    dateFormat: user.dateFormat,
    numberFormat: user.numberFormat,
    timezone: user.timezone,
    locale: user.locale,
    fxAutoUpdate: user.fxAutoUpdate,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/** Current user, preferences, and the entities the UI scopes by. */
export async function getMe(userId: string, db: DbClient) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new LedgerError("User not found", 404, { code: "user.not_found" });
  const personal = await getPersonalEntity(userId, db);
  const entities = await listEntities(userId, db);
  return {
    ...serializeUser(user),
    personalEntityId: personal.id,
    entities: entities.map((e) => ({ id: e.id, kind: e.kind, name: e.name, defaultCurrency: e.defaultCurrency, color: e.color })),
  };
}

/** The stored spelling of each format preference, or a coded 422 (the MCP settings tool passes free text). */
function normalizeFormats(patch: PreferencesPatch): Pick<PreferencesPatch, "theme" | "dateFormat" | "numberFormat"> {
  const invalid = (field: string, value: string) =>
    new LedgerError(`'${value}' is not a valid ${field}`, 422, { code: "user.invalid_preference", params: { field, value } });
  if (patch.theme !== undefined && !isTheme(patch.theme)) throw invalid("theme", patch.theme);
  if (patch.dateFormat !== undefined && !isDateFormat(patch.dateFormat)) throw invalid("dateFormat", patch.dateFormat);
  const numberFormat = patch.numberFormat === undefined ? undefined : normalizeNumberFormat(patch.numberFormat);
  if (patch.numberFormat !== undefined && !numberFormat) throw invalid("numberFormat", patch.numberFormat);
  return { theme: patch.theme, dateFormat: patch.dateFormat, numberFormat };
}

/**
 * Base amounts are fixed when an entry is written, so changing the base
 * currency once the ledger has entries would mix two currencies in every
 * total. It is refused (409 user.base_currency_locked) unless `force` is
 * passed. A base change also re-expresses the currency rates against the
 * new base, and switching the automatic FX update on or off relabels the
 * currencies' sources (see currencies/services/fx-preferences.ts), all in
 * one transaction with the user row.
 */
export async function updatePreferences(userId: string, patch: PreferencesPatch, outer: DbClient, opts: { force?: boolean } = {}) {
  return inTransaction(outer, async (db) => {
    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user) throw new LedgerError("User not found", 404, { code: "user.not_found" });
    if (patch.timezone) {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: patch.timezone });
      } catch {
        throw new LedgerError(`Unknown timezone '${patch.timezone}'`, 422, { code: "user.invalid_timezone", params: { timezone: patch.timezone } });
      }
    }
    const formats = normalizeFormats(patch);
    const baseCurrency = patch.baseCurrency?.toUpperCase();
    const baseChanges = baseCurrency !== undefined && baseCurrency !== user.baseCurrency;
    if (baseChanges) {
      const entries = await db.ledgerEntry.count({ where: { userId } });
      if (entries > 0 && !opts.force) {
        throw new LedgerError(
          `User has ${entries} transaction(s). Base amounts are stored in the current base currency, so changing it makes historical totals wrong. Pass force: true to change it anyway.`,
          409,
          { code: "user.base_currency_locked", params: { count: entries } }
        );
      }
    }
    const updated = await db.user.update({
      where: { id: userId },
      data: {
        ...(patch.name !== undefined && { name: patch.name }),
        ...(baseCurrency !== undefined && { baseCurrency }),
        ...(formats.theme !== undefined && { theme: formats.theme }),
        ...(formats.dateFormat !== undefined && { dateFormat: formats.dateFormat }),
        ...(formats.numberFormat !== undefined && { numberFormat: formats.numberFormat }),
        ...(patch.timezone !== undefined && { timezone: patch.timezone }),
        ...(patch.locale !== undefined && { locale: patch.locale }),
        ...(patch.fxAutoUpdate !== undefined && { fxAutoUpdate: patch.fxAutoUpdate }),
      },
    });
    if (baseChanges) await rebaseCurrencies(userId, user.baseCurrency, updated.baseCurrency, db, resolveLocale(updated.locale));
    if (patch.fxAutoUpdate !== undefined && patch.fxAutoUpdate !== user.fxAutoUpdate) {
      await relabelCurrencySources(userId, updated.baseCurrency, patch.fxAutoUpdate, db);
    }
    return serializeUser(updated);
  });
}
