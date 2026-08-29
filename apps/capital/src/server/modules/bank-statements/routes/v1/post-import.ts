import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { executeImport } from "../../services/execute-import";
import { routeConfig } from "../../constants";

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const TransactionInputSchema = z.object({
  externalId: z.string().min(1),
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.number().positive(),
  type: z.enum(["income", "expense"]),
});

const CreditCardInputSchema = z.object({
  bankName: z.string().min(1),
  lastFourDigits: z.string().length(4),
  closingDay: z.number().int().min(1).max(31),
  dueDay: z.number().int().min(1).max(31),
  currency: z.string().length(3),
});

const TransferInputSchema = z.object({
  externalId: z.string().min(1),
  date: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
  direction: z.enum(["profit_distribution", "capital_injection", "reimbursement"]),
  counterpartyEntityType: z.enum(["business", "personal"]),
  counterpartyEntityId: z.string().min(1),
});

const InvestmentTransferInputSchema = z.object({
  externalId: z.string().min(1),
  date: z.string().min(1),
  amount: z.number().positive(),
  description: z.string().optional(),
  direction: z.enum(["investment_deposit", "investment_withdrawal"]),
  investmentAccountId: z.string().min(1),
});

const ReconciliationUpdateSchema = z.object({
  existingTransactionId: z.string().min(1),
  externalId: z.string().min(1),
  updates: z.object({
    amount: z.number().positive().optional(),
    date: z.string().min(1).optional(),
    description: z.string().min(1).optional(),
  }),
});

const FuzzyDuplicateSchema = z.object({
  existingTransactionId: z.string().min(1),
  externalId: z.string().min(1),
});

const ImportRequestSchema = z.object({
  entityType: z.enum(["personal", "business"]),
  entityId: z.string().min(1),
  currency: z.string().length(3),
  bankName: z.string().optional(),
  fileName: z.string().optional(),
  ledgerBalance: z.number().optional(),
  transactions: z.array(TransactionInputSchema),
  transfers: z.array(TransferInputSchema).optional(),
  creditCards: z.array(CreditCardInputSchema).optional(),
  investmentTransfers: z.array(InvestmentTransferInputSchema).optional(),
  reconciliations: z.array(ReconciliationUpdateSchema).optional(),
  fuzzyDuplicates: z.array(FuzzyDuplicateSchema).optional(),
});

const ImportResponseSchema = z.object({
  imported: z.number(),
  duplicatesSkipped: z.number(),
  reconciled: z.number(),
  transfersCreated: z.number(),
  creditCardsCreated: z.number(),
  investmentTransfersCreated: z.number(),
  fuzzyDuplicatesLinked: z.number(),
  statementImportId: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/bank-statements/import",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Import bank statement transactions",
  description:
    "Bulk-creates transactions from parsed bank statement data with server-side deduplication and reconciliation",
  request: {
    body: jsonContent(ImportRequestSchema, "Transactions to import"),
  },
  responses: {
    [CREATED]: jsonContent(ImportResponseSchema, "Import result"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

// ---------------------------------------------------------------------------
// Handler
//
// Thin adapter over services/execute-import.ts: translates this route's
// wire format (fuzzyDuplicates) into the canonical ImportPlanPayload shape
// (duplicateDecisions) that execute-import.ts also serves to the
// assistant's commit_plan tool, so both surfaces share one write path.
// ---------------------------------------------------------------------------

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");

    const result = await executeImport(
      userId,
      {
        entityType: body.entityType,
        entityId: body.entityId,
        currency: body.currency,
        bankName: body.bankName,
        fileName: body.fileName,
        ledgerBalance: body.ledgerBalance,
        transactions: body.transactions,
        transfers: body.transfers ?? [],
        investmentTransfers: body.investmentTransfers ?? [],
        creditCards: body.creditCards ?? [],
        bills: [],
        reconciliations: body.reconciliations ?? [],
        duplicateDecisions: (body.fuzzyDuplicates ?? []).map((fd) => ({
          externalId: fd.externalId,
          resolution: "link_fuzzy" as const,
          existingTransactionId: fd.existingTransactionId,
        })),
        investmentTransactions: [],
      },
      prisma,
      { source: "manual" }
    );

    return c.json(
      {
        imported: result.imported,
        duplicatesSkipped: result.duplicatesSkipped,
        reconciled: result.reconciled,
        transfersCreated: result.transfersCreated,
        creditCardsCreated: result.creditCardsCreated,
        investmentTransfersCreated: result.investmentTransfersCreated,
        fuzzyDuplicatesLinked: result.fuzzyDuplicatesLinked,
        statementImportId: result.statementImportId,
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found") || message.includes("access denied")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
