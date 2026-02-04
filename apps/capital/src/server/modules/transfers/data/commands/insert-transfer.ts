import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransferDirection } from "@prisma/client";

interface CreateTransferData {
  fromEntityType: EntityType;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  exchangeRate: number;
  description?: string;
  date: Date;
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
}

export async function insertTransfer(data: CreateTransferData, db: DbClient) {
  return db.transfer.create({
    data,
  });
}
