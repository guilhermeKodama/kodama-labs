import type { DbClient } from "@capital/server/lib/prisma";

interface CreateUserData {
  email: string;
  name: string;
  baseCurrency?: string;
}

export async function insertUser(data: CreateUserData, db: DbClient) {
  return db.user.create({
    data: {
      email: data.email,
      name: data.name,
      baseCurrency: data.baseCurrency ?? "USD",
      personalAccount: {
        create: {
          defaultCurrency: data.baseCurrency ?? "USD",
        },
      },
    },
    include: {
      personalAccount: true,
    },
  });
}
