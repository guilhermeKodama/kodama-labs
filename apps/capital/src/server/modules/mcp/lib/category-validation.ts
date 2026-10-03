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

/**
 * Validate a category name and suggest close matches if not found.
 */
export async function validateCategory(
  userId: string,
  categoryName: string,
  type: TransactionType | undefined,
  db: DbClient
): Promise<{ valid: boolean; suggestions: string[] }> {
  const categories = await fetchCategoriesByUserId(userId, type, db);
  const validNames = categories.map((c) => c.name);

  const normalized = categoryName.trim();
  const valid = validNames.includes(normalized);

  if (valid) {
    return { valid: true, suggestions: [] };
  }

  const suggestions = findSimilarNames(normalized, validNames);
  return { valid: false, suggestions };
}

/**
 * Find transactions with categories that don't match any existing category.
 */
export async function findOrphanTransactions(
  userId: string,
  db: DbClient
) {
  // Get all valid category names
  const categories = await fetchCategoriesByUserId(userId, undefined, db);
  const validNames = new Set(categories.map((c) => c.name));

  // Get all transactions
  const transactions = await db.transaction.findMany({
    where: {
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: {
      id: true,
      category: true,
      description: true,
      amount: true,
      date: true,
      type: true,
    },
    orderBy: {
      date: 'desc',
    },
  });

  // Filter to orphans
  const orphans = transactions.filter((t) => !validNames.has(t.category));

  // Group by category name for stats
  const categoryGroups = new Map<string, number>();
  for (const orphan of orphans) {
    categoryGroups.set(orphan.category, (categoryGroups.get(orphan.category) ?? 0) + 1);
  }

  return {
    total: orphans.length,
    categories: Array.from(categoryGroups.entries()).map(([name, count]) => ({
      name,
      count,
    })),
    transactions: orphans.map((t) => ({
      id: t.id,
      category: t.category,
      description: t.description,
      amount: t.amount,
      date: t.date.toISOString(),
      type: t.type,
    })),
  };
}
