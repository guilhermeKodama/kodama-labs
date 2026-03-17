import { createRoute, z } from "@hono/zod-openapi";
import { OK, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { parseOfxContent } from "../../services/parsers";
import { toDateString } from "@capital/server/lib/date-utils";
import {
  normalizeTransactions,
  classifyTransactions,
  detectReconciliation,
  type EntityInfo,
  type InvestmentAccountInfo,
} from "../../services/reconciliation";
import { routeConfig } from "../../constants";

// ---------------------------------------------------------------------------
// Request / Response schemas
// ---------------------------------------------------------------------------

const FileSchema = z.object({
  content: z.string().min(1),
  fileName: z.string().min(1),
});

const ParseRequestSchema = z.object({
  files: z.array(FileSchema).min(1),
});

const ClassificationCandidateSchema = z.object({
  type: z.enum([
    "regular_transaction",
    "entity_transfer",
    "investment_transfer",
    "credit_card_payment",
  ]),
  confidence: z.enum(["high", "medium", "low"]),
  transferDetails: z
    .object({
      suggestedEntityId: z.string(),
      suggestedEntityName: z.string(),
      suggestedEntityType: z.enum(["business", "personal"]),
      suggestedDirection: z.enum([
        "profit_distribution",
        "capital_injection",
        "reimbursement",
      ]),
    })
    .optional(),
  investmentDetails: z
    .object({
      direction: z.enum(["investment_deposit", "investment_withdrawal"]),
      suggestedAccountId: z.string().optional(),
    })
    .optional(),
  creditCardDetails: z
    .object({
      suggestedBankName: z.string(),
      dueDay: z.number(),
      closingDay: z.number(),
    })
    .optional(),
});

const FieldDiffSchema = z.object({
  field: z.enum(["amount", "date", "description"]),
  existingValue: z.string(),
  ofxValue: z.string(),
});

const ParsedTransactionSchema = z.object({
  fitId: z.string(),
  date: z.string(),
  description: z.string(),
  fullDescription: z.string(),
  amount: z.number(),
  type: z.enum(["income", "expense"]),
  // Reconciliation
  reconciliationStatus: z.enum(["new", "duplicate", "changed"]),
  existingTransactionId: z.string().optional(),
  diffs: z.array(FieldDiffSchema).optional(),
  // Classification
  candidates: z.array(ClassificationCandidateSchema),
  resolvedClassification: z
    .enum([
      "regular_transaction",
      "entity_transfer",
      "investment_transfer",
      "credit_card_payment",
    ])
    .optional(),
  needsResolution: z.boolean(),
  // Legacy compat
  isDuplicate: z.boolean(),
});

const ParseResponseSchema = z.object({
  bankName: z.string(),
  accountId: z.string(),
  currency: z.string(),
  ledgerBalance: z.number(),
  transactions: z.array(ParsedTransactionSchema),
  summary: z.object({
    totalIncome: z.number(),
    totalExpenses: z.number(),
    newCount: z.number(),
    duplicateCount: z.number(),
    changedCount: z.number(),
    needsResolutionCount: z.number(),
  }),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/bank-statements/parse",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Parse OFX bank statement files",
  description:
    "Parses OFX files and returns a preview of transactions with reconciliation status and classification candidates",
  request: {
    body: jsonContent(ParseRequestSchema, "OFX files to parse"),
  },
  responses: {
    [OK]: jsonContent(ParseResponseSchema, "Parsed statement data"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid file data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(
      ErrorResponseSchema,
      "Internal server error"
    ),
  },
});

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");

    // Parse all OFX files and merge transactions (dedup within batch by FITID)
    let bankName = "";
    let accountId = "";
    let currency = "BRL";
    let latestBalanceDate = new Date(0);
    let ledgerBalance = 0;

    const seenFitIds = new Set<string>();
    const allRawTransactions: Array<{
      fitId: string;
      date: Date;
      amount: number;
      memo: string;
      trnType: string;
    }> = [];

    for (const file of body.files) {
      const parsed = parseOfxContent(file.content);
      if (!bankName) bankName = parsed.bankName;
      if (!accountId) accountId = parsed.account.accountId;
      if (parsed.currency) currency = parsed.currency;

      if (parsed.balanceDate > latestBalanceDate) {
        latestBalanceDate = parsed.balanceDate;
        ledgerBalance = parsed.ledgerBalance;
      }

      for (const tx of parsed.transactions) {
        if (seenFitIds.has(tx.fitId)) continue;
        seenFitIds.add(tx.fitId);
        allRawTransactions.push(tx);
      }
    }

    const normalized = normalizeTransactions(allRawTransactions);

    // Fetch existing transactions with full data for reconciliation
    const fitIds = normalized.map((t) => t.fitId);
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        externalId: { in: fitIds },
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      select: {
        id: true,
        externalId: true,
        amount: true,
        date: true,
        description: true,
        type: true,
      },
    });

    const existingData = existingTransactions.map((t) => ({
      id: t.id,
      externalId: t.externalId!,
      amount: t.amount,
      date: t.date,
      description: t.description,
      type: t.type as "income" | "expense",
    }));

    // Reconciliation: detect new / duplicate / changed
    const reconciled = detectReconciliation(normalized, existingData);

    // Fetch user entities for classification
    const userBusinesses = await prisma.business.findMany({
      where: { userId },
      select: { id: true, name: true },
    });

    const userPersonalAccounts = await prisma.personalAccount.findMany({
      where: { userId },
      select: { id: true },
    });

    const entities: EntityInfo[] = userBusinesses.map((b) => ({
      id: b.id,
      name: b.name,
      entityType: "business" as const,
    }));

    const investmentAccounts: InvestmentAccountInfo[] = await prisma.investmentAccount
      .findMany({
        where: {
          OR: [
            { business: { userId } },
            { personalAccount: { userId } },
          ],
        },
        select: { id: true, name: true },
      });

    // Classification: only classify non-duplicate transactions
    const newTransactions = reconciled.filter((t) => t.status === "new");
    const changedTransactions = reconciled.filter((t) => t.status === "changed");
    const transactionsToClassify = [...newTransactions, ...changedTransactions];

    const classified = classifyTransactions(
      transactionsToClassify,
      entities,
      investmentAccounts,
      bankName
    );
    const classificationMap = new Map(classified.map((c) => [c.fitId, c]));

    // Build response
    const transactions = reconciled.map((tx) => {
      const classification = classificationMap.get(tx.fitId);
      return {
        fitId: tx.fitId,
        date: toDateString(tx.date),
        description: tx.description,
        fullDescription: tx.fullDescription,
        amount: tx.amount,
        type: tx.type,
        reconciliationStatus: tx.status,
        existingTransactionId: tx.existingTransactionId,
        diffs: tx.diffs,
        candidates: classification?.candidates ?? [
          { type: "regular_transaction" as const, confidence: "high" as const },
        ],
        resolvedClassification: classification?.resolvedClassification,
        needsResolution: classification?.needsResolution ?? false,
        isDuplicate: tx.status === "duplicate",
      };
    });

    let totalIncome = 0;
    let totalExpenses = 0;
    let newCount = 0;
    let duplicateCount = 0;
    let changedCount = 0;
    let needsResolutionCount = 0;

    for (const t of transactions) {
      if (t.reconciliationStatus === "duplicate") {
        duplicateCount++;
      } else if (t.reconciliationStatus === "changed") {
        changedCount++;
      } else {
        newCount++;
        if (t.type === "income") totalIncome += t.amount;
        else totalExpenses += t.amount;
      }
      if (t.needsResolution) needsResolutionCount++;
    }

    return c.json(
      {
        bankName,
        accountId,
        currency,
        ledgerBalance: Math.round(ledgerBalance * 100) / 100,
        transactions,
        summary: {
          totalIncome: Math.round(totalIncome * 100) / 100,
          totalExpenses: Math.round(totalExpenses * 100) / 100,
          newCount,
          duplicateCount,
          changedCount,
          needsResolutionCount,
        },
      },
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("No STMTRS") || message.includes("No valid")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
