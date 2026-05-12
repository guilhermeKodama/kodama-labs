import type { DbClient } from "@capital/server/lib/prisma";
import { updateBusiness as updateBusinessCmd } from "../data/commands/update-business";

interface UpdateBusinessInput {
  name?: string;
  description?: string;
  defaultCurrency?: string;
  color?: string;
  taxRate?: number;
  initialBalance?: number;
}

export async function updateBusinessService(
  userId: string,
  id: string,
  input: UpdateBusinessInput,
  db: DbClient
) {
  // Data layer will verify ownership
  return updateBusinessCmd(userId, id, input, db);
}
