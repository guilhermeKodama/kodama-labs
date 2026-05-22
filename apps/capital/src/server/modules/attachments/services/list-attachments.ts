import type { DbClient } from "@capital/server/lib/prisma";
import { verifyOwnerAccess } from "./verify-owner";
import { fetchAttachmentsByOwner } from "../data/queries/fetch-attachments";
import type { AttachmentOwnerType } from "../constants";

export async function listAttachments(
  userId: string,
  ownerType: AttachmentOwnerType,
  ownerId: string,
  db: DbClient,
) {
  await verifyOwnerAccess(userId, ownerType, ownerId, db);
  return fetchAttachmentsByOwner(ownerType, ownerId, db);
}
