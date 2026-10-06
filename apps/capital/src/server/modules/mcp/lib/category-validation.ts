import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { fetchCategoriesByUserId } from "../../categories/data/queries/fetch-categories";
import { findUncategorized } from "../../categories/services/categories";

/**
 * Calculate Levenshtein distance between two strings for fuzzy matching.
 */
function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Find similar category names using fuzzy matching.
 */
function findSimilarNames(input: string, validNames: string[], maxResults = 3): string[] {
  const normalized = input.toLowerCase().trim();
  
  const scored = validNames
    .map((name) => ({
      name,
      distance: levenshteinDistance(normalized, name.toLowerCase()),
      startsWith: name.toLowerCase().startsWith(normalized),
      includes: name.toLowerCase().includes(normalized),
    }))
    .sort((a, b) => {
      // Prioritize starts-with matches
      if (a.startsWith && !b.startsWith) return -1;
      if (!a.startsWith && b.startsWith) return 1;
      // Then includes matches
      if (a.includes && !b.includes) return -1;
      if (!a.includes && b.includes) return 1;
      // Then by edit distance
      return a.distance - b.distance;
    });

  return scored.slice(0, maxResults).map((s) => s.name);
}

export interface CategoryNameMatch {
  valid: boolean;
  /** True when the name matches a row that is hidden from pickers. */
  archived: boolean;
  suggestions: string[];
  /** Canonical stored name when valid, including a case-insensitive hit. */
  canonicalName?: string;
  /** Names that can be assigned to new records. Archived names are omitted. */
  validNames: string[];
}

type CategoryLookupRow = {
  name: string;
  type: TransactionType;
  isArchived?: boolean;
};

/**
 * Match a category name against an already-loaded list.
 * Exact match wins. Otherwise a case-insensitive match is accepted and
 * canonicalName is the stored spelling. An archived match is not valid for
 * a new assignment. Unknown names stay invalid. Suggestions come from the
 * visible names only.
 */
export function matchCategoryName(
  categoryName: string,
  categories: CategoryLookupRow[],
  type: TransactionType | undefined
): CategoryNameMatch {
  const pool = type ? categories.filter((c) => c.type === type) : categories;
  const validNames = pool.filter((c) => !c.isArchived).map((c) => c.name);
  const normalized = categoryName.trim();
  const exact = pool.find((c) => c.name === normalized);
  if (exact) {
    return {
      valid: !exact.isArchived,
      archived: !!exact.isArchived,
      suggestions: [],
      canonicalName: exact.name,
      validNames,
    };
  }

  const folded = normalized.toLowerCase();
  const insensitive = pool.find((c) => c.name.toLowerCase() === folded);
  if (insensitive) {
    return {
      valid: !insensitive.isArchived,
      archived: !!insensitive.isArchived,
      suggestions: [],
      canonicalName: insensitive.name,
      validNames,
    };
  }

  return {
    valid: false,
    archived: false,
    suggestions: findSimilarNames(normalized, validNames),
    validNames,
  };
}

export function formatCategoryValidationError(
  categoryName: string,
  type: TransactionType | undefined,
  validation: CategoryNameMatch
): string {
  if (validation.archived) {
    const name = validation.canonicalName ?? categoryName;
    return (
      `Category '${name}' is archived and cannot be assigned. ` +
      `Unarchive it or choose a visible category.`
    );
  }
  const suggestions = validation.suggestions.length > 0
    ? ` Did you mean: ${validation.suggestions.join(", ")}?`
    : "";
  const names = validation.validNames.length > 0
    ? ` Valid categories: ${validation.validNames.join(", ")}.`
    : "";
  const typeLabel = type ? ` (type: ${type})` : "";
  return `Category '${categoryName}' not found${typeLabel}.${suggestions}${names}`;
}

/**
 * Reject a user-facing assignment of an archived category.
 * Unknown names are left alone so existing free-text writers keep working.
 * Passing currentName allows an update that does not change the category.
 *
 * Internal system writes must not call this. They call internalCategoryName
 * (credit_card, other_system, other_income) and write that name even when
 * the row is archived.
 */
export async function rejectArchivedAssignment(
  userId: string,
  categoryName: string,
  type: TransactionType | undefined,
  db: DbClient,
  currentName?: string
): Promise<void> {
  const categories = await fetchCategoriesByUserId(userId, type, db, {
    includeArchived: true,
  });
  const validation = matchCategoryName(categoryName, categories, type);
  if (!validation.archived) return;
  if (
    currentName &&
    validation.canonicalName &&
    currentName.toLowerCase() === validation.canonicalName.toLowerCase()
  ) {
    return;
  }
  throw new Error(formatCategoryValidationError(categoryName, type, validation));
}

/** Lowercased names of archived categories, for skipping learned mappings. */
export async function archivedCategoryNameSet(
  userId: string,
  db: DbClient
): Promise<Set<string>> {
  const rows = await db.category.findMany({
    where: { userId, isArchived: true },
    select: { name: true },
  });
  return new Set(rows.map((row) => row.name.toLowerCase()));
}

/**
 * Validate a category name and suggest close matches if not found.
 */
export async function validateCategory(
  userId: string,
  categoryName: string,
  type: TransactionType | undefined,
  db: DbClient
): Promise<CategoryNameMatch> {
  const categories = await fetchCategoriesByUserId(userId, type, db, {
    includeArchived: true,
  });
  return matchCategoryName(categoryName, categories, type);
}

/**
 * Transactions that still need a category: no category at all, or an
 * archived one. (Categories are foreign keys now, so a name that matches
 * nothing can no longer exist.) Grouped by current category name, with
 * "(none)" for uncategorized.
 */
export async function findOrphanTransactions(userId: string, db: DbClient) {
  const { total, rows } = await findUncategorized(userId, db, { limit: 100 });
  const groups = await db.ledgerEntry.groupBy({
    by: ["categoryId"],
    where: {
      userId,
      deletedAt: null,
      transferGroupId: null,
      kind: { in: ["income", "expense"] },
      OR: [{ categoryId: null }, { category: { isArchived: true } }],
    },
    _count: { id: true },
  });
  const names = new Map(
    (await db.category.findMany({ where: { id: { in: groups.map((g) => g.categoryId).filter((id): id is string => !!id) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name])
  );
  return {
    total,
    categories: groups.map((g) => ({ name: g.categoryId ? names.get(g.categoryId) ?? "(none)" : "(none)", count: g._count.id })),
    transactions: rows.map((t) => ({
      id: t.id,
      category: t.category?.name ?? null,
      description: t.description,
      amount: Math.abs(Number(t.amount)),
      date: t.date.toISOString(),
      type: t.kind,
    })),
  };
}
