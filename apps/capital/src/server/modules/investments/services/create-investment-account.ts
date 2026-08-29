import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";
import { insertInvestmentAccount } from "../data/commands/insert-investment-account";

interface CreateInvestmentAccountInput {
  name: string;
  broker?: string;
  entityType: EntityType;
  currency: string;
  businessId?: string;
  personalAccountId?: string;
}

export async function createInvestmentAccount(
  userId: string,
  input: CreateInvestmentAccountInput,
  db: DbClient
) {
  // Validate entity ownership - a presence check alone isn't enough, the
  // id itself must actually belong to this user, or insertInvestmentAccount
  // will happily `connect` the new account to someone else's business/
  // personalAccount (it does a bare Prisma connect with no scoping).
  if (input.entityType === "business") {
    if (!input.businessId) {
      throw new Error("businessId is required for business entity type");
    }
    const business = await db.business.findFirst({
      where: { id: input.businessId, userId },
      select: { id: true },
    });
    if (!business) {
      throw new Error("Business not found or access denied");
    }
  }
  if (input.entityType === "personal") {
    if (!input.personalAccountId) {
      throw new Error("personalAccountId is required for personal entity type");
    }
    const personalAccount = await db.personalAccount.findFirst({
      where: { id: input.personalAccountId, userId },
      select: { id: true },
    });
    if (!personalAccount) {
      throw new Error("Personal account not found or access denied");
    }
  }

  return insertInvestmentAccount(
    {
      userId,
      ...input,
    },
    db
  );
}
