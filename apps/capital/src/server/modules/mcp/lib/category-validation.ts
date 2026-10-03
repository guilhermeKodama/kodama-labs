import type { DbClient } from "@capital/server/lib/prisma";
import type { TransactionType } from "@/generated/prisma";
import { fetchCategoriesByUserId } from "../../categories/data/queries/fetch-categories";

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
  suggestions: string[];
  /** Canonical stored name when valid, including a case-insensitive hit. */
  canonicalName?: string;
  validNames: string[];
}

/**
 * Match a category name against an already-loaded list.
 * Exact match wins. Otherwise a case-insensitive match is accepted and
 * canonicalName is the stored spelling. Unknown names stay invalid.
 */
export function matchCategoryName(
  categoryName: string,
  categories: Array<{ name: string; type: TransactionType }>,
  type: TransactionType | undefined
): CategoryNameMatch {
  const pool = type ? categories.filter((c) => c.type === type) : categories;
  const validNames = pool.map((c) => c.name);
  const normalized = categoryName.trim();
  const exact = pool.find((c) => c.name === normalized);
  if (exact) {
    return { valid: true, suggestions: [], canonicalName: exact.name, validNames };
  }

  const folded = normalized.toLowerCase();
  const insensitive = pool.find((c) => c.name.toLowerCase() === folded);
  if (insensitive) {
    return { valid: true, suggestions: [], canonicalName: insensitive.name, validNames };
  }

  return {
    valid: false,
    suggestions: findSimilarNames(normalized, validNames),
    validNames,
  };
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
  const categories = await fetchCategoriesByUserId(userId, type, db);
  return matchCategoryName(categoryName, categories, type);
}

/**
 * Find transactions with categories that don't match any existing category.
 */
export async function findOrphanTransactions(
  userId: string,
  db: DbClient
) {
  const categories = await fetchCategoriesByUserId(userId, undefined, db);
  const validNames = categories.map((c) => c.name);

  const where = {
    OR: [
      { business: { userId } },
      { personalAccount: { userId } },
    ],
    ...(validNames.length > 0 ? { category: { notIn: validNames } } : {}),
  };

  const [total, groups, transactions] = await Promise.all([
    db.transaction.count({ where }),
    db.transaction.groupBy({
      by: ["category"],
      where,
      _count: { id: true },
    }),
    db.transaction.findMany({
      where,
      select: {
        id: true,
        category: true,
        description: true,
        amount: true,
        date: true,
        type: true,
      },
      orderBy: { date: "desc" },
      take: 100,
    }),
  ]);

  return {
    total,
    categories: groups.map((g) => ({
      name: g.category,
      count: g._count.id,
    })),
    transactions: transactions.map((t) => ({
      id: t.id,
      category: t.category,
      description: t.description,
      amount: t.amount,
      date: t.date.toISOString(),
      type: t.type,
    })),
  };
}
