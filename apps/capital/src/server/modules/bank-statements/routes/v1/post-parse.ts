import { createRoute, z } from "@hono/zod-openapi";
import { OK, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { parseOfxContent } from "../../services/parsers";
import { toDateString } from "@capital/server/lib/date-utils";
import { extractShortTitle } from "../../utils";
import { routeConfig } from "../../constants";

const FileSchema = z.object({
  content: z.string().min(1),
  fileName: z.string().min(1),
});

const ParseRequestSchema = z.object({
  files: z.array(FileSchema).min(1),
});

const ParsedTransactionSchema = z.object({
  fitId: z.string(),
  date: z.string(),
  description: z.string(),
  fullDescription: z.string(),
  amount: z.number(),
  type: z.enum(["income", "expense"]),
  isDuplicate: z.boolean(),
});

const DetectedCreditCardPaymentSchema = z.object({
  fitId: z.string(),
  amount: z.number(),
  date: z.string(),
  suggestedBankName: z.string(),
  dueDay: z.number(),
  closingDay: z.number(),
});

const DetectedTransferSchema = z.object({
  fitId: z.string(),
  amount: z.number(),
  date: z.string(),
  description: z.string(),
  fullDescription: z.string(),
  type: z.enum(["income", "expense"]),
  suggestedEntityId: z.string(),
  suggestedEntityName: z.string(),
  suggestedEntityType: z.enum(["business", "personal"]),
  suggestedDirection: z.enum([
    "profit_distribution",
    "capital_injection",
    "reimbursement",
  ]),
});

const ParseResponseSchema = z.object({
  bankName: z.string(),
  accountId: z.string(),
  currency: z.string(),
  ledgerBalance: z.number(),
  transactions: z.array(ParsedTransactionSchema),
  detectedCreditCardPayments: z.array(DetectedCreditCardPaymentSchema),
  detectedTransfers: z.array(DetectedTransferSchema),
  summary: z.object({
    totalIncome: z.number(),
    totalExpenses: z.number(),
    newCount: z.number(),
    duplicateCount: z.number(),
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
  description: "Parses OFX files and returns a preview of transactions for import",
  request: {
    body: jsonContent(ParseRequestSchema, "OFX files to parse"),
  },
  responses: {
    [OK]: jsonContent(ParseResponseSchema, "Parsed statement data"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid file data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

const CREDIT_CARD_PAYMENT_PATTERNS = [
  "pagamento de fatura",
];

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");

    // Parse all OFX files and merge transactions
    const allTransactions: Array<{
      fitId: string;
      date: Date;
      description: string;
      fullDescription: string;
      amount: number;
      type: "income" | "expense";
    }> = [];
    let bankName = "";
    let accountId = "";
    let currency = "BRL";
    let latestBalanceDate = new Date(0);
    let ledgerBalance = 0;

    const seenFitIds = new Set<string>();

    for (const file of body.files) {
      const parsed = parseOfxContent(file.content);
      if (!bankName) bankName = parsed.bankName;
      if (!accountId) accountId = parsed.account.accountId;
      if (parsed.currency) currency = parsed.currency;

      // Track the most recent ledger balance across all files
      if (parsed.balanceDate > latestBalanceDate) {
        latestBalanceDate = parsed.balanceDate;
        ledgerBalance = parsed.ledgerBalance;
      }

      for (const tx of parsed.transactions) {
        if (seenFitIds.has(tx.fitId)) continue;
        seenFitIds.add(tx.fitId);

        allTransactions.push({
          fitId: tx.fitId,
          date: tx.date,
          description: extractShortTitle(tx.memo),
          fullDescription: tx.memo,
          amount: Math.abs(tx.amount),
          type: tx.amount >= 0 ? "income" : "expense",
        });
      }
    }

    // Check for existing transactions by externalId
    const fitIds = allTransactions.map((t) => t.fitId);
    const existingTransactions = await prisma.transaction.findMany({
      where: {
        externalId: { in: fitIds },
        OR: [
          { business: { userId } },
          { personalAccount: { userId } },
        ],
      },
      select: { externalId: true },
    });
    const existingFitIds = new Set(existingTransactions.map((t) => t.externalId));

    // Detect credit card payments and infer due/closing days from payment dates
    const detectedCreditCardPayments = allTransactions
      .filter((t) => {
        const lower = t.description.toLowerCase();
        return CREDIT_CARD_PAYMENT_PATTERNS.some((p) => lower.includes(p));
      })
      .map((t) => {
        const dueDay = t.date.getUTCDate();
        // Closing day is typically ~10 days before due day in Brazil
        const closingDay = dueDay <= 10 ? dueDay + 20 : dueDay - 10;
        return {
          fitId: t.fitId,
          amount: t.amount,
          date: toDateString(t.date),
          suggestedBankName: bankName,
          dueDay,
          closingDay,
        };
      });

    // Detect transfers to/from registered entities
    const userBusinesses = await prisma.business.findMany({
      where: { userId },
      select: { id: true, name: true },
    });

    const normalizeForMatch = (s: string) =>
      s.toLowerCase().replace(/[^a-záàâãéêíóôõúüç0-9\s]/gi, "").replace(/\s+/g, " ").trim();

    const entityCandidates = userBusinesses.map((b) => ({
      id: b.id,
      name: b.name,
      normalized: normalizeForMatch(b.name),
      entityType: "business" as const,
    }));

    // Extract counterparty name from OFX memo for matching
    function extractCounterparty(memo: string): string | null {
      const pixSent = memo.match(/^Transferência enviada pelo Pix(?:\s+via\s+Open\s+Banking)?\s*-\s*([^-]+)/i);
      if (pixSent) return pixSent[1].trim();
      const pixReceived = memo.match(/^Transferência recebida pelo Pix\s*-\s*([^-]+)/i);
      if (pixReceived) return pixReceived[1].trim();
      const boleto = memo.match(/^Pagamento de boleto efetuado\s*-\s*([^-]+)/i);
      if (boleto) return boleto[1].trim();
      const ted = memo.match(/^TED\s+(?:enviada|recebida)\s*-\s*([^-]+)/i);
      if (ted) return ted[1].trim();
      return null;
    }

    const detectedTransferFitIds = new Set<string>();
    const detectedTransfers: Array<{
      fitId: string;
      amount: number;
      date: string;
      description: string;
      fullDescription: string;
      type: "income" | "expense";
      suggestedEntityId: string;
      suggestedEntityName: string;
      suggestedEntityType: "business" | "personal";
      suggestedDirection: "profit_distribution" | "capital_injection" | "reimbursement";
    }> = [];

    for (const tx of allTransactions) {
      if (existingFitIds.has(tx.fitId)) continue;
      const counterparty = extractCounterparty(tx.fullDescription);
      if (!counterparty) continue;
      const normalizedCounterparty = normalizeForMatch(counterparty);

      for (const entity of entityCandidates) {
        // Match if the counterparty name starts with the entity name or vice versa
        // (OFX often truncates names)
        const matches =
          normalizedCounterparty.startsWith(entity.normalized) ||
          entity.normalized.startsWith(normalizedCounterparty) ||
          normalizedCounterparty.includes(entity.normalized) ||
          entity.normalized.includes(normalizedCounterparty);

        if (matches && entity.normalized.length >= 3) {
          // expense from personal = money going to business (capital_injection)
          // income to personal = money coming from business (profit_distribution)
          const direction = tx.type === "expense" ? "capital_injection" : "profit_distribution";

          detectedTransfers.push({
            fitId: tx.fitId,
            amount: tx.amount,
            date: toDateString(tx.date),
            description: tx.description,
            fullDescription: tx.fullDescription,
            type: tx.type,
            suggestedEntityId: entity.id,
            suggestedEntityName: entity.name,
            suggestedEntityType: entity.entityType,
            suggestedDirection: direction,
          });
          detectedTransferFitIds.add(tx.fitId);
          break;
        }
      }
    }

    // Build response
    const transactions = allTransactions.map((t) => ({
      fitId: t.fitId,
      date: toDateString(t.date),
      description: t.description,
      fullDescription: t.fullDescription,
      amount: t.amount,
      type: t.type,
      isDuplicate: existingFitIds.has(t.fitId),
    }));

    let totalIncome = 0;
    let totalExpenses = 0;
    let newCount = 0;
    let duplicateCount = 0;

    for (const t of transactions) {
      if (t.isDuplicate) {
        duplicateCount++;
      } else {
        newCount++;
        if (t.type === "income") totalIncome += t.amount;
        else totalExpenses += t.amount;
      }
    }

    return c.json(
      {
        bankName,
        accountId,
        currency,
        ledgerBalance: Math.round(ledgerBalance * 100) / 100,
        transactions,
        detectedCreditCardPayments,
        detectedTransfers,
        summary: {
          totalIncome: Math.round(totalIncome * 100) / 100,
          totalExpenses: Math.round(totalExpenses * 100) / 100,
          newCount,
          duplicateCount,
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
