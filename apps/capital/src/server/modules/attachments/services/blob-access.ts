import type { DbClient } from "@capital/server/lib/prisma";

/**
 * Whether `userId` may download the stored file at `pathname` (the path
 * under /api/blob/). Only two things store files: attachments of the
 * user's transactions, transfers and recurring rules, and files of the
 * user's assistant conversations. Anything else is no one's to read.
 */
export async function canReadBlob(userId: string, pathname: string, db: DbClient): Promise<boolean> {
  const [attachments, conversationFiles] = await Promise.all([
    db.attachment.count({
      where: { pathname, OR: [{ ledgerEntry: { userId } }, { transferGroup: { userId } }, { recurringRule: { userId } }] },
    }),
    db.conversationFile.count({ where: { pathname, userId } }),
  ]);
  return attachments + conversationFiles > 0;
}
