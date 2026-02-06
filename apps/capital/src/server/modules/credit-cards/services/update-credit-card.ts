import type { DbClient } from "@capital/server/lib/prisma";
import { updateCreditCard as updateCreditCardCmd } from "../data/commands/update-credit-card";

interface UpdateCreditCardInput {
  bankName?: string;
  lastFourDigits?: string;
  nickname?: string;
  creditLimit?: number;
  closingDay?: number;
  dueDay?: number;
  color?: string;
  currency?: string;
  isActive?: boolean;
}

export async function updateCreditCardService(
  userId: string,
  id: string,
  input: UpdateCreditCardInput,
  db: DbClient
) {
  // Validate closing/due days if provided
  if (input.closingDay !== undefined && (input.closingDay < 1 || input.closingDay > 31)) {
    throw new Error("closingDay must be between 1 and 31");
  }
  if (input.dueDay !== undefined && (input.dueDay < 1 || input.dueDay > 31)) {
    throw new Error("dueDay must be between 1 and 31");
  }

  // Validate last four digits if provided
  if (input.lastFourDigits && !/^\d{4}$/.test(input.lastFourDigits)) {
    throw new Error("lastFourDigits must be exactly 4 digits");
  }

  return updateCreditCardCmd(userId, id, input, db);
}
