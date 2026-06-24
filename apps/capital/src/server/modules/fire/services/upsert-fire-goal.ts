import type { DbClient } from "@capital/server/lib/prisma";
import type { FireGoalInput } from "../validations/fire";
import { upsertFireGoal as upsertFireGoalCommand } from "../data/commands/upsert-fire-goal";

export async function upsertFireGoal(userId: string, input: FireGoalInput, db: DbClient) {
  return upsertFireGoalCommand(userId, input, db);
}
