import type { DbClient } from "@capital/server/lib/prisma";

export async function deleteAttachmentRow(id: string, db: DbClient) {
  return db.attachment.delete({ where: { id } });
}
