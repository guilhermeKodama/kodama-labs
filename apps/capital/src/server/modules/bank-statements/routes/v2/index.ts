import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { ImportPlanPayloadSchema } from "@capital/server/modules/assistant/agent/tools/schemas/import-plan-payload";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { analyzeImport } from "../../services/analyze-import";
import { analyzeStatement } from "../../services/analyze-statement";
import { decodeImportContent } from "../../services/import-files";
import { executeImport, type CreatedRecordRef } from "../../services/execute-import";
import { executeRevert } from "../../services/execute-revert";
import { importCardBill } from "../../services/import-card-bill";

const tags = ["Imports v2"];
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const listRoute = createRoute({ method: "get", path: "/v2/imports", tags, summary: "Import history with per-import counts", responses: v2Responses });

const analyzeRoute = createRoute({
  method: "post",
  path: "/v2/imports/analyze",
  tags,
  summary: "Read statement files (bank OFX, card OFX or CSV) and compare them with the ledger; writes nothing",
  description:
    "Detects the kind of file, the bank, the period and the account it belongs to (accountId overrides), the card statement it fills, and per row whether it is a duplicate (dup), categorized by a rule (rule) or by the AI (ai, only with ai: true and an Anthropic key), or still needs a category (need). A PDF or an image comes back as { kind, viaAssistant: true }. Content is text or base64.",
  request: jsonBody(
    z.object({
      files: z.array(z.object({ name: z.string().optional(), content: z.string().min(1), encoding: z.enum(["base64", "text"]).optional() })).min(1).max(10),
      accountId: z.string().min(1).nullish(),
      ai: z.boolean().optional(),
      /** The old Ajustes wizard's response (rows with reconciliation candidates); goes away with that wizard. */
      legacy: z.boolean().optional(),
    })
  ),
  responses: v2Responses,
});

const commitRoute = createRoute({
  method: "post",
  path: "/v2/imports",
  tags,
  summary: "Commit a reviewed import plan",
  description:
    "One transaction and one undo batch (source import). The response has importId, batchId, accountName, imported, skipped, rulesCreated and viewId, the saved view “Importação · <arquivo>” that shows exactly this import.",
  request: jsonBody(ImportPlanPayloadSchema),
  responses: v2Responses,
});

const revertRoute = createRoute({
  method: "post",
  path: "/v2/imports/{id}/revert",
  tags,
  summary: "Undo an import: everything it created goes to the trash",
  request: { params: idParams },
  responses: v2Responses,
});

const cardFileRoute = createRoute({
  method: "post",
  path: "/v2/accounts/{id}/statements/import-file",
  tags,
  summary: "Import a card bill file (CSV or card OFX) into the statement closing on closingDate, as an import (history, revert, one undo batch)",
  request: { params: idParams, ...jsonBody(z.object({ closingDate: dateString, dueDate: dateString, content: z.string().min(1), fileName: z.string().optional() })) },
  responses: v2Responses,
});

const cardRowsRoute = createRoute({
  method: "post",
  path: "/v2/accounts/{id}/statements/import-rows",
  tags,
  summary: "Import card statement rows (re-importing the same rows is a no-op)",
  request: {
    params: idParams,
    ...jsonBody(
      z.object({
        month: z.string().regex(/^\d{4}-\d{2}$/),
        closingDate: dateString.optional(),
        dueDate: dateString.optional(),
        total: z.number().optional(),
        rows: z
          .array(
            z.object({
              date: dateString,
              description: z.string().min(1),
              amount: z.number(),
              currency: z.string().length(3).optional(),
              categoryId: z.string().optional(),
              installment: z.object({ number: z.number().int().min(1), total: z.number().int().min(1) }).optional(),
            })
          )
          .min(1)
          .max(2000),
      })
    ),
  },
  responses: v2Responses,
});

async function createdRecordsFor(userId: string, importId: string): Promise<CreatedRecordRef[]> {
  const action = await prisma.agentAction.findFirst({
    where: { userId, toolName: "commit_plan", status: "success", createdRecords: { array_contains: [{ model: "Import", id: importId }] } },
    orderBy: { createdAt: "desc" },
    select: { createdRecords: true },
  });
  return Array.isArray(action?.createdRecords) ? (action.createdRecords as unknown as CreatedRecordRef[]) : [];
}

export const v2Imports = createRouter()
  .openapi(
    listRoute,
    v2Handler(listRoute, async (_c, userId) => {
      const imports = await prisma.import.findMany({
        where: { userId },
        orderBy: { createdAt: "desc" },
        take: 200,
        include: {
          entity: { select: { id: true, name: true, kind: true } },
          account: { select: { id: true, name: true, type: true } },
          _count: { select: { ledgerEntries: true, transferGroups: true } },
        },
      });
      return {
        imports: imports.map((i) => ({
          id: i.id,
          entity: i.entity,
          accountId: i.accountId,
          account: i.account,
          /** A card bill (imported into a card) or a bank statement. */
          kind: i.account?.type === "credit_card" ? ("card" as const) : ("bank" as const),
          bankName: i.bankName,
          fileName: i.fileName,
          source: i.source,
          transactionCount: i.transactionCount,
          entries: i._count.ledgerEntries,
          transfers: i._count.transferGroups,
          categorizationStatus: i.categorizationStatus,
          conversationId: i.conversationId,
          revertedAt: i.revertedAt?.toISOString() ?? null,
          createdAt: i.createdAt.toISOString(),
        })),
      };
    })
  )
  .openapi(
    analyzeRoute,
    v2Handler(analyzeRoute, async (c, userId) => {
      const body = c.req.valid("json");
      if (body.legacy) return analyzeStatement(userId, body.files.map((f) => ({ content: decodeImportContent(f.content, f.encoding).toString("utf8") })), prisma);
      return analyzeImport(userId, { files: body.files, accountId: body.accountId, ai: body.ai }, prisma);
    })
  )
  .openapi(commitRoute, v2Handler(commitRoute, async (c, userId) => executeImport(userId, c.req.valid("json"), prisma, { source: "manual", createView: true })))
  .openapi(
    revertRoute,
    v2Handler(revertRoute, async (c, userId) => {
      const { id } = c.req.valid("param");
      const imp = await prisma.import.findFirst({ where: { id, userId }, select: { id: true } });
      if (!imp) throw new LedgerError("Import not found", 404, { code: "import.not_found" });
      return executeRevert(userId, { statementImportId: id, createdRecords: await createdRecordsFor(userId, id) }, prisma);
    })
  )
  .openapi(
    cardFileRoute,
    v2Handler(cardFileRoute, async (c, userId) => {
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      return importCardBill(userId, { accountId: id, closingDate: body.closingDate, dueDate: body.dueDate, content: body.content, fileName: body.fileName }, prisma);
    })
  )
  .openapi(
    cardRowsRoute,
    v2Handler(cardRowsRoute, async (c, userId) => {
      const { id } = c.req.valid("param");
      return importCardStatement(userId, { accountId: id, ...c.req.valid("json"), fallback: "none" }, prisma);
    })
  );
