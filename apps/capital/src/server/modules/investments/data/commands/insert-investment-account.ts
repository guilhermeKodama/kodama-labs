import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@/generated/prisma";

interface CreateInvestmentAccountData {
  userId: string;
  name: string;
  broker?: string;
  entityType: EntityType;
  currency: string;
  businessId?: string;
  personalAccountId?: string;
}

export async function insertInvestmentAccount(
  data: CreateInvestmentAccountData,
  db: DbClient
) {
  return db.investmentAccount.create({
    data: {
      user: { connect: { id: data.userId } },
      name: data.name,
      broker: data.broker,
      entityType: data.entityType,
      currency: data.currency,
      ...(data.businessId
        ? { business: { connect: { id: data.businessId } } }
        : {}),
      ...(data.personalAccountId
        ? { personalAccount: { connect: { id: data.personalAccountId } } }
        : {}),
    },
  });
}
