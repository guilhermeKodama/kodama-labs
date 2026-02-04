import type { DbClient } from "@capital/server/lib/prisma";

interface UpdateUserData {
  name?: string;
  baseCurrency?: string;
  theme?: string;
  dateFormat?: string;
  numberFormat?: string;
}

export async function updateUser(
  userId: string,
  data: UpdateUserData,
  db: DbClient
) {
  return db.user.update({
    where: { id: userId },
    data,
    include: {
      personalAccount: true,
    },
  });
}
