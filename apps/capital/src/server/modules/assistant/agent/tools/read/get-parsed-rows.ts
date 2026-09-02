import { z } from "zod";
import { defineTool } from "../registry";
import { fetchConversationFileById } from "../../../data/queries/fetch-conversation-files";
import type { OfxParsedPayload, CsvParsedPayload } from "../../../services/detect-and-parse-file";

export const getParsedRows = defineTool({
  name: "get_parsed_rows",
  description:
    "Page through the deterministically-parsed rows of an OFX or CSV file (max 50 per call). Never transcribe a statement yourself - always read it through this tool. Returns an error for PDF files (they arrive as a document block on the message instead) or files that failed to parse.",
  inputSchema: z.object({
    fileId: z.string(),
    offset: z.number().int().min(0).default(0),
    limit: z.number().int().min(1).max(50).default(50),
  }),
  access: "read",
  handler: async (ctx, input) => {
    const file = await fetchConversationFileById(
      input.fileId,
      ctx.conversationId,
      ctx.userId,
      ctx.db
    );
    if (!file) {
      throw new Error("File not found in this conversation");
    }
    if (file.fileType === "pdf") {
      throw new Error(
        "This is a PDF - it has no parsed rows. Read it from the document block attached to the message instead."
      );
    }
    if (file.fileType === "image") {
      throw new Error(
        "This is an image - it has no parsed rows. The image itself is attached to the message; just look at it."
      );
    }
    if (file.parseStatus !== "parsed" || !file.parsedPayload) {
      throw new Error(`File is not parsed (status: ${file.parseStatus})`);
    }

    const payload = file.parsedPayload as unknown as OfxParsedPayload | CsvParsedPayload;
    const allRows = payload.rows;
    const page = allRows.slice(input.offset, input.offset + input.limit);

    return {
      fileId: file.id,
      totalRows: allRows.length,
      offset: input.offset,
      rows: page,
      hasMore: input.offset + page.length < allRows.length,
    };
  },
});
