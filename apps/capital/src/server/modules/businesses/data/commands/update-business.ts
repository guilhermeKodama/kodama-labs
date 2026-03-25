import type { DbClient } from "@capital/server/lib/prisma";

interface UpdateBusinessData {
  name?: string;
  description?: string;
  defaultCurrency?: string;
  color?: string;
  taxRate?: number;
  initialBalance?: number;
}

/**
 * Update a business, scoped to the authenticated user.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The business ID
 * @param data - The data to update
 * @returns The updated business
 * @throws If business not found or not owned by user
 */
export async function updateBusiness(
  userId: string,
  id: string,
  data: UpdateBusinessData,
  db: DbClient
) {
  // First verify ownership
  const business = await db.business.findFirst({
    where: { id, userId },
    select: { id: true },
  });

  if (!business) {
    throw new Error("Business not found");
  }

  return db.business.update({
    where: { id },
    data,
  });
}
