import type { DbClient } from "@capital/server/lib/prisma";
import { upsertSubscription } from "../data/commands/upsert-subscription";

interface SubscribeInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  deviceLabel?: string;
  userAgent?: string;
}

export async function subscribeToPush(
  userId: string,
  input: SubscribeInput,
  db: DbClient
) {
  return upsertSubscription(userId, input, db);
}
