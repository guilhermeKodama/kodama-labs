import type { DbClient } from "@capital/server/lib/prisma";
import { insertUser } from "../data/commands/insert-user";
import { fetchUserByEmail } from "../data/queries/fetch-user-by-email";

interface CreateUserInput {
  email: string;
  name: string;
  baseCurrency?: string;
}

export async function createUser(input: CreateUserInput, db: DbClient) {
  // Check if user already exists
  const existingUser = await fetchUserByEmail(input.email, db);
  if (existingUser) {
    throw new Error("User with this email already exists");
  }

  return insertUser(input, db);
}
