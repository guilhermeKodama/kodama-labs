import { z } from "zod";
import { defineTool } from "../registry";
import { fetchConversationFileById } from "../../../data/queries/fetch-conversation-files";
import { fetchReconciliationContext } from "../../../data/queries/fetch-reconciliation-context";
import { fetchEntityForAgent } from "../../../data/queries/fetch-entity-for-agent";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import {
  detectReconciliation,
  classifyTransactions,
  computeBalanceDiscrepancy,
  type NormalizedTransaction,
} from "@capital/server/modules/bank-statements/services/reconciliation";
import type { OfxParsedPayload } from "../../../services/detect-and-parse-file";

export const reconcileStatement = defineTool({
  name: "reconcile_statement",
  description:
    "Compare a parsed OFX file's rows against the user's existing data for one entity: detects duplicate/changed/fuzzy-matched/new transactions and suggests a classification (regular transaction, entity transfer, investment transfer, credit card payment) for each. This is the same engine the manual import wizard uses. Only works on OFX files (fileType 'ofx').",
  inputSchema: z.object({
    fileId: z.string(),
    entityType: z.enum(["business", "personal"]),
    entityId: z.string(),
  }),
  access: "read",
  handler: async (ctx, input) => {
    const file = await fetchConversationFileById(
      input.fileId,
      ctx.conversationId,
      ctx.userId,
      ctx.db
    );
    if (!file) throw new Error("File not found in this conversation");
    if (file.fileType !== "ofx") {
      throw new Error("reconcile_statement only supports OFX files - use get_parsed_rows for CSV");
    }
    if (file.parseStatus !== "parsed" || !file.parsedPayload) {
      throw new Error(`File is not parsed (status: ${file.parseStatus})`);
    }

    const entity = await fetchEntityForAgent(ctx.userId, input.entityType, input.entityId, ctx.db);
    if (!entity) {
      throw new Error(`${input.entityType} entity not found or access denied`);
    }

    const payload = file.parsedPayload as unknown as OfxParsedPayload;
    const normalized: NormalizedTransaction[] = payload.rows.map((row) => ({
      fitId: row.fitId,
      date: parseLocalDate(row.date),
      description: row.description,
      fullDescription: row.fullDescription,
      amount: row.amount,
      type: row.type,
    }));

    const reconContext = await fetchReconciliationContext(ctx.userId, ctx.db);

    const reconciled = detectReconciliation(
      normalized,
      reconContext.existingTransactions,
      reconContext.knownTransferFitIds
    );

    const toClassify = reconciled.filter((t) => t.status !== "duplicate");
    const classified = classifyTransactions(
      toClassify,
      reconContext.entities,
      reconContext.investmentAccounts,
      payload.bankName
    );
    const classificationByFitId = new Map(classified.map((c) => [c.fitId, c]));

    const rows = reconciled.map((tx) => {
      const classification = classificationByFitId.get(tx.fitId);
      return {
        fitId: tx.fitId,
        date: tx.date.toISOString().split("T")[0],
        description: tx.description,
        fullDescription: tx.fullDescription,
        amount: tx.amount,
        type: tx.type,
        status: tx.status,
        existingTransactionId: tx.existingTransactionId,
        diffs: tx.diffs,
        fuzzyMatchedTransaction: tx.fuzzyMatchedTransaction,
        candidates:
          classification?.candidates ?? [{ type: "regular_transaction" as const, confidence: "high" as const }],
        resolvedClassification: classification?.resolvedClassification,
        needsResolution: classification?.needsResolution ?? false,
      };
    });

    const summary = {
      new: rows.filter((r) => r.status === "new").length,
      duplicate: rows.filter((r) => r.status === "duplicate").length,
      changed: rows.filter((r) => r.status === "changed").length,
      fuzzyMatch: rows.filter((r) => r.status === "fuzzy_match").length,
      needsResolution: rows.filter((r) => r.needsResolution).length,
    };

    const balance = computeBalanceDiscrepancy(normalized, payload.ledgerBalance, entity.initialBalance);

    return { rows, summary, balance };
  },
});
