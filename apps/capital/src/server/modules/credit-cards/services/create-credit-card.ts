import type { DbClient } from "@capital/server/lib/prisma";
import type { EntityType } from "@prisma/client";
import { insertCreditCard } from "../data/commands/insert-credit-card";

interface CreateCreditCardInput {
  entityType: EntityType;
  bankName: string;
  lastFourDigits: string;
  nickname?: string;
  creditLimit: number;
  closingDay: number;
  dueDay: number;
  color?: string;
  currency: string;
  businessId?: string;
  personalAccountId?: string;
}

export async function createCreditCard(
  userId: string,
  input: CreateCreditCardInput,
  db: DbClient
) {
  // Validate entity matches type
  if (input.entityType === "business" && !input.businessId) {
    throw new Error("businessId is required for business entity type");
  }
  if (input.entityType === "personal" && !input.personalAccountId) {
    throw new Error("personalAccountId is required for personal entity type");
  }

  // Validate closing/due days
  if (input.closingDay < 1 || input.closingDay > 31) {
    throw new Error("closingDay must be between 1 and 31");
  }
  if (input.dueDay < 1 || input.dueDay > 31) {
    throw new Error("dueDay must be between 1 and 31");
  }

  // Validate last four digits
  if (!/^\d{4}$/.test(input.lastFourDigits)) {
    throw new Error("lastFourDigits must be exactly 4 digits");
  }

  return insertCreditCard(userId, input, db);
}
