import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { normalizeDescription } from "../../utils";
import { routeConfig } from "../../constants";

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

const ImportRequestSchema = z.object({
  entityType: z.enum(["personal", "business"]),
  entityId: z.string().min(1),
  currency: z.string().length(3),
  bankName: z.string().optional(),
  fileName: z.string().optional(),
  ledgerBalance: z.number().optional(),
  transactions: z.array(TransactionInputSchema).min(1),
  creditCards: z.array(CreditCardInputSchema).optional(),
});

const ImportResponseSchema = z.object({
  imported: z.number(),
  creditCardsCreated: z.number(),
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
  description: "Bulk-creates transactions from parsed bank statement data",
  request: {
    body: jsonContent(ImportRequestSchema, "Transactions to import"),
  },
  responses: {
    [CREATED]: jsonContent(ImportResponseSchema, "Import result"),
    [BAD_REQUEST]: jsonContent(ErrorResponseSchema, "Invalid request data"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

const SYSTEM_EXPENSE_CATEGORIES = [
  "Credit Card",
  "Subscriptions",
  "Groceries",
  "Restaurants & Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Health & Pharmacy",
  "Travel",
  "Education",
  "Personal Care",
  "Home",
  "Fees & Charges",
  "Other",
];

const SYSTEM_INCOME_CATEGORIES = [
  "Salary",
  "Freelance",
  "Investment Returns",
  "Transfers",
  "Other Income",
];

async function ensureSystemCategories(userId: string) {
  const existing = await prisma.category.findMany({
    where: { userId },
    select: { name: true, type: true },
  });
  const existingKeys = new Set(existing.map((c) => `${c.type}:${c.name}`));

  const toCreate: Array<{ userId: string; name: string; type: "expense" | "income"; isDefault: boolean; isSystem: boolean }> = [];

  for (const name of SYSTEM_EXPENSE_CATEGORIES) {
    if (!existingKeys.has(`expense:${name}`)) {
      toCreate.push({ userId, name, type: "expense", isDefault: true, isSystem: true });
    }
  }
  for (const name of SYSTEM_INCOME_CATEGORIES) {
    if (!existingKeys.has(`income:${name}`)) {
      toCreate.push({ userId, name, type: "income", isDefault: true, isSystem: true });
    }
  }

  if (toCreate.length > 0) {
    await prisma.category.createMany({ data: toCreate, skipDuplicates: true });
  }
}

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");

    // Verify entity ownership
    if (body.entityType === "personal") {
      const pa = await prisma.personalAccount.findFirst({
        where: { id: body.entityId, userId },
        select: { id: true },
      });
      if (!pa) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: "Personal account not found or access denied" } },
          BAD_REQUEST
        );
      }
    } else {
      const biz = await prisma.business.findFirst({
        where: { id: body.entityId, userId },
        select: { id: true },
      });
      if (!biz) {
        return c.json(
          { error: { code: "BAD_REQUEST", message: "Business not found or access denied" } },
          BAD_REQUEST
        );
      }
    }

    await ensureSystemCategories(userId);

    // Load merchant category mappings for quick lookup
    const mappings = await prisma.merchantCategoryMapping.findMany({
      where: { userId },
      select: { normalizedDescription: true, category: true },
    });
    const mappingLookup = new Map(mappings.map((m) => [m.normalizedDescription, m.category]));

    // Create StatementImport record
    const statementImport = await prisma.statementImport.create({
      data: {
        userId,
        entityType: body.entityType,
        bankName: body.bankName,
        fileName: body.fileName,
        transactionCount: body.transactions.length,
        ledgerBalance: body.ledgerBalance,
        ledgerCurrency: body.currency,
        categorizationStatus: "pending",
        businessId: body.entityType === "business" ? body.entityId : undefined,
        personalAccountId: body.entityType === "personal" ? body.entityId : undefined,
      },
    });

    // Create credit cards if requested
    let creditCardsCreated = 0;
    if (body.creditCards && body.creditCards.length > 0) {
      for (const card of body.creditCards) {
        await prisma.creditCard.create({
          data: {
            entityType: body.entityType,
            bankName: card.bankName,
            lastFourDigits: card.lastFourDigits,
            creditLimit: 0,
            closingDay: card.closingDay,
            dueDay: card.dueDay,
            currency: card.currency,
            businessId: body.entityType === "business" ? body.entityId : undefined,
            personalAccountId: body.entityType === "personal" ? body.entityId : undefined,
          },
        });
        creditCardsCreated++;
      }
    }

    // Build transaction data with category mapping
    const txData = body.transactions.map((t) => {
      const mapped = mappingLookup.get(normalizeDescription(t.description));
      return {
        entityType: body.entityType as "personal" | "business",
        type: t.type as "income" | "expense",
        amount: t.amount,
        currency: body.currency,
        description: t.description,
        category: mapped ?? "Uncategorized",
        date: parseLocalDate(t.date),
        externalId: t.externalId,
        statementImportId: statementImport.id,
        businessId: body.entityType === "business" ? body.entityId : undefined,
        personalAccountId: body.entityType === "personal" ? body.entityId : undefined,
      };
    });

    // Bulk insert
    const result = await prisma.transaction.createMany({ data: txData });

    // If all transactions got a category, mark as completed immediately
    const allCategorized = txData.every((t) => t.category !== "Uncategorized");
    if (allCategorized) {
      await prisma.statementImport.update({
        where: { id: statementImport.id },
        data: { categorizationStatus: "completed" },
      });
    }

    return c.json(
      {
        imported: result.count,
        creditCardsCreated,
        statementImportId: statementImport.id,
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
