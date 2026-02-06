import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Delete a credit card, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The credit card ID
 * @throws If credit card not found or not owned by user
 */
export async function deleteCreditCard(
  userId: string,
  id: string,
  db: DbClient
) {
  // MANDATORY: Verify ownership
  const card = await db.creditCard.findFirst({
    where: {
      id,
      OR: [
        { business: { userId } },
        { personalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!card) {
    throw new Error("Credit card not found");
  }

  return db.creditCard.delete({
    where: { id },
  });
}
