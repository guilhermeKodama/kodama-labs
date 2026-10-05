import type { User } from "@/generated/prisma";
import type { DbClient } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { getPersonalEntity, listEntities } from "@capital/server/modules/ledger/services/entities";

export interface PreferencesPatch {
  name?: string;
  baseCurrency?: string;
  theme?: string;
  dateFormat?: string;
  numberFormat?: string;
  timezone?: string;
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
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}

/** Current user, preferences, and the entities the UI scopes by. */
export async function getMe(userId: string, db: DbClient) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new LedgerError("User not found", 404);
  const personal = await getPersonalEntity(userId, db);
  const entities = await listEntities(userId, db);
  return {
    ...serializeUser(user),
    personalEntityId: personal.id,
    entities: entities.map((e) => ({ id: e.id, kind: e.kind, name: e.name, defaultCurrency: e.defaultCurrency, color: e.color })),
  };
}

/**
 * Base amounts are fixed when an entry is written, so changing the base
 * currency once the ledger has entries would mix two currencies in every
 * total. It is refused unless `force` is passed.
 */
export async function updatePreferences(userId: string, patch: PreferencesPatch, db: DbClient, opts: { force?: boolean } = {}) {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (!user) throw new LedgerError("User not found", 404);
  if (patch.timezone) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: patch.timezone });
    } catch {
      throw new LedgerError(`Unknown timezone '${patch.timezone}'`, 422);
    }
  }
  if (patch.baseCurrency && patch.baseCurrency !== user.baseCurrency) {
    const entries = await db.ledgerEntry.count({ where: { userId } });
    if (entries > 0 && !opts.force) {
      throw new LedgerError(
        `User has ${entries} transaction(s). Base amounts are stored in the current base currency, so changing it makes historical totals wrong. Pass force: true to change it anyway.`,
        409
      );
    }
  }
  const updated = await db.user.update({
    where: { id: userId },
    data: {
      ...(patch.name !== undefined && { name: patch.name }),
      ...(patch.baseCurrency !== undefined && { baseCurrency: patch.baseCurrency }),
      ...(patch.theme !== undefined && { theme: patch.theme }),
      ...(patch.dateFormat !== undefined && { dateFormat: patch.dateFormat }),
      ...(patch.numberFormat !== undefined && { numberFormat: patch.numberFormat }),
      ...(patch.timezone !== undefined && { timezone: patch.timezone }),
    },
  });
  return serializeUser(updated);
}
