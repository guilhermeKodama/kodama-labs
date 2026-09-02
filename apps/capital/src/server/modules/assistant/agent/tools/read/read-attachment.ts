import { z } from "zod";
import { defineTool, TOOL_MEDIA_KEY, type ToolMediaRef } from "../registry";
import { verifyOwnerAccess } from "@capital/server/modules/attachments/services/verify-owner";
import { fetchAttachmentsByOwner } from "@capital/server/modules/attachments/data/queries/fetch-attachments";
import { MAX_IMAGES_PER_TURN, isAllowedImageMediaType } from "../../../constants";

/** Types the Messages API can actually read; anything else is listed but not loaded. */
function isReadable(mimeType: string): boolean {
  return mimeType === "application/pdf" || isAllowedImageMediaType(mimeType);
}

export const readAttachment = defineTool({
  name: "read_attachment",
  description:
    "Abre os comprovantes anexados a uma transação, transferência ou recorrência existente (recibo, boleto, comprovante de Pix) para que você possa VER o conteúdo. Aceita imagens (JPEG/PNG/WebP/GIF) e PDFs. Use quando o usuário perguntar sobre o comprovante de um lançamento que já está na base - o resultado inclui o próprio arquivo.",
  inputSchema: z.object({
    ownerType: z.enum(["transaction", "transfer", "recurringTransaction", "recurringTransfer"]),
    ownerId: z.string().min(1),
    attachmentId: z
      .string()
      .optional()
      .describe("Opcional - omita para carregar todos os anexos legíveis desse lançamento."),
  }),
  access: "read",
  handler: async (ctx, input) => {
    // Ownership is enforced here, from the session's userId - never from
    // anything the model passed in.
    await verifyOwnerAccess(ctx.userId, input.ownerType, input.ownerId, ctx.db);

    const all = await fetchAttachmentsByOwner(input.ownerType, input.ownerId, ctx.db);
    const scoped = input.attachmentId
      ? all.filter((a) => a.id === input.attachmentId)
      : all;

    if (input.attachmentId && scoped.length === 0) {
      throw new Error("Attachment not found on that record");
    }

    const readable = scoped.filter((a) => isReadable(a.mimeType));
    const loaded = readable.slice(0, MAX_IMAGES_PER_TURN);

    const media: ToolMediaRef[] = loaded.map((a) => ({
      attachmentId: a.id,
      originalName: a.originalName,
      blobUrl: a.blobUrl,
      mediaType: a.mimeType,
    }));

    return {
      attachments: scoped.map((a) => ({
        attachmentId: a.id,
        originalName: a.originalName,
        kind: a.kind,
        mimeType: a.mimeType,
        sizeBytes: a.sizeBytes,
        loaded: loaded.some((l) => l.id === a.id),
      })),
      loadedCount: loaded.length,
      skippedCount: scoped.length - loaded.length,
      [TOOL_MEDIA_KEY]: media,
    };
  },
});
