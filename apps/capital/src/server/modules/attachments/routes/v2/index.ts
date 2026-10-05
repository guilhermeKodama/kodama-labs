import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { ATTACHMENT_OWNER_TYPES, deleteAttachment, listAttachments, serializeAttachment, uploadAttachment } from "../../services/attachments";

const tags = ["Attachments v2"];
const kindSchema = z.enum(["BILL", "RECEIPT", "TRANSFER_RECEIPT"]);
const ownerTypeSchema = z.enum(ATTACHMENT_OWNER_TYPES);

const listRoute = createRoute({
  method: "get",
  path: "/v2/attachments",
  tags,
  summary: "Attachments of one owner, or of every owner of a type",
  request: { query: z.object({ ownerType: ownerTypeSchema, ownerId: z.string().optional() }) },
  responses: v2Responses,
});

const uploadRoute = createRoute({
  method: "post",
  path: "/v2/attachments",
  tags,
  summary: "Upload a bill, receipt or transfer receipt (multipart: file, kind, ownerType, ownerId)",
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({ file: z.custom<File>().openapi({ type: "string", format: "binary" }), kind: kindSchema, ownerType: ownerTypeSchema, ownerId: z.string() }),
        },
      },
    },
  },
  responses: v2Responses,
});

const deleteRouteDef = createRoute({ method: "delete", path: "/v2/attachments/{id}", tags, summary: "Delete an attachment", request: { params: idParams }, responses: v2Responses });

export const v2Attachments = createRouter()
  .openapi(listRoute, v2Handler(listRoute, async (c, userId) => {
    const { ownerType, ownerId } = c.req.valid("query");
    return { attachments: (await listAttachments(userId, ownerType, ownerId, prisma)).map(serializeAttachment) };
  }))
  .openapi(uploadRoute, v2Handler(uploadRoute, async (c, userId) => {
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) throw new LedgerError("file is required", 400, { code: "attachment.file_required" });
    const kind = kindSchema.safeParse(body["kind"]);
    const ownerType = ownerTypeSchema.safeParse(body["ownerType"]);
    const ownerId = body["ownerId"];
    if (!kind.success || !ownerType.success || typeof ownerId !== "string" || !ownerId) throw new LedgerError("kind, ownerType and ownerId are required", 400, { code: "attachment.fields_required" });
    const created = await uploadAttachment(
      userId,
      { kind: kind.data, ownerType: ownerType.data, ownerId, file: { buffer: Buffer.from(await file.arrayBuffer()), mimeType: file.type, originalName: file.name } },
      prisma
    );
    return serializeAttachment(created);
  }))
  .openapi(deleteRouteDef, v2Handler(deleteRouteDef, async (c, userId) => {
    await deleteAttachment(userId, c.req.valid("param").id, prisma);
    return { success: true };
  }));
