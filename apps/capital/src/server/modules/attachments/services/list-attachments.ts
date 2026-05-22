import type { DbClient } from "@capital/server/lib/prisma";
import { verifyOwnerAccess } from "./verify-owner";
import {
  fetchAttachmentsByOwner,
  fetchAttachmentsByOwnerType,
} from "../data/queries/fetch-attachments";
import type { AttachmentOwnerType } from "../constants";

export async function listAttachments(
  userId: string,
  ownerType: AttachmentOwnerType,
  ownerId: string | undefined,
  db: DbClient,
) {
  if (ownerId) {
    await verifyOwnerAccess(userId, ownerType, ownerId, db);
    return fetchAttachmentsByOwner(ownerType, ownerId, db);
  }
  return fetchAttachmentsByOwnerType(userId, ownerType, db);
}
