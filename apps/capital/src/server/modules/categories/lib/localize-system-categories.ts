import type { DbClient } from "@capital/server/lib/prisma";
import { resolveLocale } from "@capital/server/i18n";
import { findSystemCategoryDefinition, systemCategoryName } from "./system-categories";

export interface LocalizeSystemCategoriesResult {
  renamed: { id: string; userId: string; from: string; to: string }[];
  /** Left in English: another category of the same user and type already has the localized name. */
  conflicts: { id: string; userId: string; name: string; wanted: string }[];
}

/**
 * Backfill for users created before system categories were named in the
 * user's locale: renames each keyed category whose name is still the
 * catalog's English name to its name in the owner's User.locale. A category
 * the user renamed keeps its name, and so does one whose localized name is
 * already taken (case-insensitively) by another category of the same type,
 * since (userId, name, type) is unique. With `dryRun` nothing is written.
 */
export async function localizeSystemCategories(db: DbClient, opts: { userId?: string; dryRun?: boolean } = {}): Promise<LocalizeSystemCategoriesResult> {
  const keyed = await db.category.findMany({
    where: { systemKey: { not: null }, ...(opts.userId && { userId: opts.userId }) },
    select: { id: true, userId: true, name: true, type: true, systemKey: true, user: { select: { locale: true } } },
    orderBy: [{ userId: "asc" }, { name: "asc" }],
  });
  const candidates = keyed.flatMap((c) => {
    const def = findSystemCategoryDefinition(c.systemKey!);
    if (!def || c.name !== def.name) return [];
    const wanted = systemCategoryName(def.systemKey, resolveLocale(c.user.locale));
    return wanted === c.name ? [] : [{ ...c, wanted }];
  });
  const result: LocalizeSystemCategoriesResult = { renamed: [], conflicts: [] };
  if (candidates.length === 0) return result;

  const nameKey = (userId: string, type: string, name: string) => `${userId}\u0000${type}\u0000${name.toLowerCase()}`;
  const all = await db.category.findMany({
    where: { userId: { in: [...new Set(candidates.map((c) => c.userId))] } },
    select: { userId: true, type: true, name: true },
  });
  const taken = new Set(all.map((c) => nameKey(c.userId, c.type, c.name)));

  for (const c of candidates) {
    if (taken.has(nameKey(c.userId, c.type, c.wanted))) {
      result.conflicts.push({ id: c.id, userId: c.userId, name: c.name, wanted: c.wanted });
      continue;
    }
    if (!opts.dryRun) await db.category.update({ where: { id: c.id }, data: { name: c.wanted } });
    taken.delete(nameKey(c.userId, c.type, c.name));
    taken.add(nameKey(c.userId, c.type, c.wanted));
    result.renamed.push({ id: c.id, userId: c.userId, from: c.name, to: c.wanted });
  }
  return result;
}
