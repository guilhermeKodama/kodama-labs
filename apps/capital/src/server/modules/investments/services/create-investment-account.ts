import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@prisma/client";
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
  // Validate entity ownership
  if (input.entityType === "business" && !input.businessId) {
    throw new Error("businessId is required for business entity type");
  }
  if (input.entityType === "personal" && !input.personalAccountId) {
    throw new Error("personalAccountId is required for personal entity type");
  }

  return insertInvestmentAccount(
    {
      userId,
      ...input,
    },
    db
  );
}
