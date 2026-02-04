import type { DbClient } from "@capital/server/lib/prisma";

interface UpdateCategoryData {
  name?: string;
  color?: string;
  icon?: string;
}

export async function updateCategory(
  id: string,
  data: UpdateCategoryData,
  db: DbClient
) {
  return db.category.update({
    where: { id },
    data,
  });
}
