import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransferDirection } from "@/generated/prisma";

interface UpdateTransferInput {
  fromEntityType?: EntityType;
  toEntityType?: EntityType;
  direction?: TransferDirection;
  amount?: number;
  currency?: string;
  exchangeRate?: number;
  description?: string | null;
  date?: Date;
  fromBusinessId?: string | null;
  fromPersonalAccountId?: string | null;
  toBusinessId?: string | null;
  toPersonalAccountId?: string | null;
  toInvestmentAccountId?: string | null;
  fromInvestmentAccountId?: string | null;
}

/**
 * Update a transfer, verifying user ownership of the transfer and of any
 * newly-referenced entities first.
 * @param userId - REQUIRED: The authenticated user's ID
 * @param id - The transfer ID
 * @param input - The data to update
 * @throws If transfer not found or not owned by user, or a referenced entity isn't owned by user
 */
export async function updateTransfer(
  userId: string,
  id: string,
  input: UpdateTransferInput,
  db: DbClient
) {
  // MANDATORY: Verify ownership through business or personalAccount
  const transfer = await db.transfer.findFirst({
    where: {
      id,
      OR: [
        { fromBusiness: { userId } },
        { fromPersonalAccount: { userId } },
        { toBusiness: { userId } },
        { toPersonalAccount: { userId } },
      ],
    },
    select: { id: true },
  });

  if (!transfer) {
    throw new Error("Transfer not found");
  }

  // MANDATORY: Verify user owns any newly-referenced source entity
  if (input.fromBusinessId) {
    const business = await db.business.findFirst({
      where: { id: input.fromBusinessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Source business not found or access denied");
    }
  }

  if (input.fromPersonalAccountId) {
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: input.fromPersonalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Source personal account not found or access denied");
    }
  }

  // MANDATORY: Verify user owns any newly-referenced target entity
  if (input.toBusinessId) {
    const business = await db.business.findFirst({
      where: { id: input.toBusinessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Target business not found or access denied");
    }
  }

  if (input.toPersonalAccountId) {
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: input.toPersonalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Target personal account not found or access denied");
    }
  }

  if (input.toInvestmentAccountId) {
    const account = await db.investmentAccount.findFirst({
      where: { id: input.toInvestmentAccountId, userId },
      select: { id: true },
    });
    if (!account) {
      throw new Error("Target investment account not found or access denied");
    }
  }

  if (input.fromInvestmentAccountId) {
    const account = await db.investmentAccount.findFirst({
      where: { id: input.fromInvestmentAccountId, userId },
      select: { id: true },
    });
    if (!account) {
      throw new Error("Source investment account not found or access denied");
    }
  }

  return db.transfer.update({
    where: { id },
    data: input,
  });
}
