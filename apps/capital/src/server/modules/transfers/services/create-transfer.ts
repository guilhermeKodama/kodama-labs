import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType, TransferDirection } from "@prisma/client";
import { insertTransfer } from "../data/commands/insert-transfer";

interface CreateTransferInput {
  fromEntityType: EntityType;
  toEntityType: EntityType;
  direction: TransferDirection;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description?: string;
  date: Date;
  fromBusinessId?: string;
  fromPersonalAccountId?: string;
  toBusinessId?: string;
  toPersonalAccountId?: string;
  toInvestmentAccountId?: string;
  fromInvestmentAccountId?: string;
}

export async function createTransfer(
  userId: string,
  input: CreateTransferInput,
  db: DbClient
) {
  // Validate entity IDs match entity types (for non-investment directions)
  if (input.direction !== "investment_deposit" && input.direction !== "investment_withdrawal") {
    if (input.fromEntityType === "business" && !input.fromBusinessId) {
      throw new Error("fromBusinessId is required for business entity type");
    }
    if (input.fromEntityType === "personal" && !input.fromPersonalAccountId) {
      throw new Error("fromPersonalAccountId is required for personal entity type");
    }
    if (input.toEntityType === "business" && !input.toBusinessId) {
      throw new Error("toBusinessId is required for business entity type");
    }
    if (input.toEntityType === "personal" && !input.toPersonalAccountId) {
      throw new Error("toPersonalAccountId is required for personal entity type");
    }
  }

  // Validate investment transfer requirements
  if (input.direction === "investment_deposit") {
    if (!input.toInvestmentAccountId) {
      throw new Error("toInvestmentAccountId is required for investment_deposit");
    }
    // Source must be a business or personal account
    if (input.fromEntityType === "business" && !input.fromBusinessId) {
      throw new Error("fromBusinessId is required for business entity type");
    }
    if (input.fromEntityType === "personal" && !input.fromPersonalAccountId) {
      throw new Error("fromPersonalAccountId is required for personal entity type");
    }
  }

  if (input.direction === "investment_withdrawal") {
    if (!input.fromInvestmentAccountId) {
      throw new Error("fromInvestmentAccountId is required for investment_withdrawal");
    }
    // Target must be a business or personal account
    if (input.toEntityType === "business" && !input.toBusinessId) {
      throw new Error("toBusinessId is required for business entity type");
    }
    if (input.toEntityType === "personal" && !input.toPersonalAccountId) {
      throw new Error("toPersonalAccountId is required for personal entity type");
    }
  }

  // Create the transfer
  const transfer = await insertTransfer(
    userId,
    {
      ...input,
      exchangeRate: input.exchangeRate ?? 1,
    },
    db
  );

  // Update investment account cash balance if applicable
  if (input.direction === "investment_deposit" && input.toInvestmentAccountId) {
    await db.investmentAccount.update({
      where: { id: input.toInvestmentAccountId },
      data: { cashBalance: { increment: input.amount } },
    });
  }

  if (input.direction === "investment_withdrawal" && input.fromInvestmentAccountId) {
    await db.investmentAccount.update({
      where: { id: input.fromInvestmentAccountId },
      data: { cashBalance: { decrement: input.amount } },
    });
  }

  return transfer;
}
