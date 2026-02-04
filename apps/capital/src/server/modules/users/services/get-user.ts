import type { DbClient } from "@capital/server/lib/prisma";
import { fetchUserById } from "../data/queries/fetch-user-by-id";
import { fetchUserByEmail } from "../data/queries/fetch-user-by-email";

export async function getUserById(userId: string, db: DbClient) {
  const user = await fetchUserById(userId, db);
  if (!user) {
    throw new Error("User not found");
  }
  return user;
}

export async function getUserByEmail(email: string, db: DbClient) {
  return fetchUserByEmail(email, db);
}
