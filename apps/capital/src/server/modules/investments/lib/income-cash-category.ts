import type { DbClient } from "@capital/server/lib/prisma";
import { getSystemCategory } from "@capital/server/modules/categories/lib/system-categories";
import { INCOME_CASH_CATEGORY, incomeCashBucket } from "@capital/server/modules/ledger/lib/income-cash-category";

/**
 * The income category a dividend or yield cash leg should carry.
 * Named "Proventos" / "Rendimentos" wins over the system row, so a user
 * who already files September that way keeps one bucket. Anyone else gets
 * the seeded system category (pt-BR: Dividendos, Rendimentos).
 * Null when the operation is not income.
 */
export async function resolveIncomeCashCategory(userId: string, incomeType: string | null | undefined, operationType: string, db: DbClient) {
  const bucket = incomeCashBucket(incomeType, operationType);
  if (!bucket) return null;
  const spec = INCOME_CASH_CATEGORY[bucket];
  const named = await db.category.findFirst({
    where: { userId, type: "income", isArchived: false, name: { equals: spec.name, mode: "insensitive" } },
    orderBy: { id: "asc" },
  });
  if (named) return named;
  return getSystemCategory(userId, spec.systemKey, db);
}
