import { z } from "@hono/zod-openapi";

export const AttachmentSchema = z.object({
  id: z.string(),
  kind: z.enum(["BILL", "RECEIPT", "TRANSFER_RECEIPT"]),
  blobUrl: z.string(),
  pathname: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number(),
  originalName: z.string(),
  uploadedAt: z.string(),
  transactionId: z.string().nullable(),
  transferId: z.string().nullable(),
  recurringTransactionId: z.string().nullable(),
  recurringTransferId: z.string().nullable(),
});
