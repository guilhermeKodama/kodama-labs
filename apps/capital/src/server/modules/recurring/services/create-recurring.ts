import type { DbClient } from "@capital/server/lib/prisma";
import type {
  EntityType,
  TransactionType,
  RecurrenceFrequency,
} from "@/generated/prisma";
import type { RemindersConfig } from "@/lib/validations/reminders";
import { insertRecurring } from "../data/commands/insert-recurring";

interface CreateRecurringInput {
  entityType: EntityType;
  type: TransactionType;
  amount: number;
  currency: string;
  exchangeRate?: number;
  description: string;
  category: string;
  frequency: RecurrenceFrequency;
  startDate: Date;
  endDate?: Date;
  autoGenerateTransaction?: boolean;
  reminders?: RemindersConfig;
  businessId?: string;
  personalAccountId?: string;
}

export async function createRecurring(
  userId: string,
  input: CreateRecurringInput,
  db: DbClient
) {
  if (input.entityType === "business" && !input.businessId) {
    throw new Error("businessId is required for business entity type");
  }
  if (input.entityType === "personal" && !input.personalAccountId) {
    throw new Error(
      "personalAccountId is required for personal entity type"
    );
  }

  // Data layer will verify ownership
  return insertRecurring(
    userId,
    {
      ...input,
      exchangeRate: input.exchangeRate ?? 1,
      autoGenerateTransaction: input.autoGenerateTransaction ?? true,
      nextDueDate: input.startDate,
    },
    db
  );
}
