import type { DbClient } from "@capital/server/lib/prisma";
import { normalizeDescription } from "../../utils";

/**
 * Update a bill transaction's category, scoped to the authenticated user.
 * Also upserts a MerchantCategoryMapping so future bills learn the choice.
 */
export async function updateBillTransaction(
  userId: string,
  id: string,
  data: { category: string },
  db: DbClient
) {
  const billTx = await db.billTransaction.findFirst({
    where: {
      id,
      bill: {
        creditCard: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
      },
    },
    select: { id: true, description: true },
  });

  if (!billTx) {
    throw new Error("Bill transaction not found");
  }

  const updated = await db.billTransaction.update({
    where: { id },
    data: {
      category: data.category,
      isAutoCategorized: false,
    },
  });

  // Persist the manual mapping so future bills use this category automatically
  const normalized = normalizeDescription(billTx.description);
  await db.merchantCategoryMapping.upsert({
    where: {
      userId_normalizedDescription: {
        userId,
        normalizedDescription: normalized,
      },
    },
    update: { category: data.category, source: "manual" },
    create: {
      userId,
      normalizedDescription: normalized,
      category: data.category,
      source: "manual",
    },
  });

  return updated;
}
