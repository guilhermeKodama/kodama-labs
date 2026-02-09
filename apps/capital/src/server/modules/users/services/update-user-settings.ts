import type { DbClient } from "@capital/server/lib/prisma";
import { updateUser } from "../data/commands/update-user";
import { fetchUserById } from "../data/queries/fetch-user-by-id";

interface UpdateUserSettingsInput {
  name?: string;
  baseCurrency?: string;
  theme?: string;
  dateFormat?: string;
  numberFormat?: string;
  timezone?: string;
}

export async function updateUserSettings(
  userId: string,
  input: UpdateUserSettingsInput,
  db: DbClient
) {
  // Verify user exists
  const existingUser = await fetchUserById(userId, db);
  if (!existingUser) {
    throw new Error("User not found");
  }

  return updateUser(userId, input, db);
}
