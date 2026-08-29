import { z } from "zod";
import { defineTool } from "../registry";
import { fetchConversationFilesForAgent } from "../../../data/queries/fetch-conversation-files";
import type { OfxParsedPayload, CsvParsedPayload } from "../../../services/detect-and-parse-file";

export const listStatementFiles = defineTool({
  name: "list_statement_files",
  description:
    "List the files attached to this conversation, with a summary of each (bank/period/currency/row count for OFX, row count for CSV, parse status). Never inlines full row data - use get_parsed_rows to page through rows.",
  inputSchema: z.object({}),
  access: "read",
  handler: async (ctx) => {
    const files = await fetchConversationFilesForAgent(ctx.conversationId, ctx.userId, ctx.db);

    const items = files.map((f) => {
      let summary: Record<string, unknown> | null = null;
      if (f.parsedPayload && f.parseStatus === "parsed") {
        if (f.fileType === "ofx") {
          const p = f.parsedPayload as unknown as OfxParsedPayload;
          summary = {
            bankName: p.bankName,
            currency: p.currency,
            dateStart: p.dateStart,
            dateEnd: p.dateEnd,
            ledgerBalance: p.ledgerBalance,
            rowCount: p.rows.length,
          };
        } else if (f.fileType === "csv") {
          const p = f.parsedPayload as unknown as CsvParsedPayload;
          summary = { rowCount: p.rows.length };
        }
      }
      return {
        fileId: f.id,
        originalName: f.originalName,
        fileType: f.fileType,
        statementKind: f.statementKind,
        sizeBytes: f.sizeBytes,
        parseStatus: f.parseStatus,
        parseError: f.parseError,
        summary,
      };
    });

    return { files: items };
  },
});
