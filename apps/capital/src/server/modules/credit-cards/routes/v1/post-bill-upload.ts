import { createRoute, z } from "@hono/zod-openapi";
import { CREATED, BAD_REQUEST, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { processBillCsv } from "../../services/process-bill-csv";
import { fetchCategoriesByUserId } from "../../../categories/data/queries/fetch-categories";
import { routeConfig } from "../../constants";

const UploadBillSchema = z.object({
  creditCardId: z.string().min(1),
  closingDate: z.string(),
  dueDate: z.string(),
  csvContent: z.string().min(1),
  csvFileName: z.string().min(1),
  transactionId: z.string().optional(), // Link to existing expense
});

const BillUploadResultSchema = z.object({
  bill: z.object({
    id: z.string(),
    creditCardId: z.string(),
    closingDate: z.string(),
    dueDate: z.string(),
    totalAmount: z.number(),
    status: z.enum(["pending", "paid", "overdue"]),
    categorizationStatus: z.string(),
  }),
  totalAmount: z.number(),
  transactionCount: z.number(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/credit-cards/bills/upload",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Upload credit card bill CSV",
  description: "Uploads and processes a CSV credit card bill with AI categorization",
  request: {
    body: jsonContent(UploadBillSchema, "Bill CSV upload data"),
  },
  responses: {
    [CREATED]: jsonContent(BillUploadResultSchema, "Bill processed"),
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

/**
 * Ensure all system expense categories exist for the user.
 * Handles users created before system categories were introduced.
 */
async function ensureSystemCategories(userId: string) {
  const existing = await fetchCategoriesByUserId(userId, "expense", prisma);
  const existingNames = new Set(existing.map((c) => c.name));

  const missing = SYSTEM_EXPENSE_CATEGORIES.filter((name) => !existingNames.has(name));
  if (missing.length > 0) {
    await prisma.category.createMany({
      data: missing.map((name) => ({
        userId,
        name,
        type: "expense" as const,
        isDefault: true,
        isSystem: true,
      })),
      skipDuplicates: true,
    });
  }
}

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);
    const body = c.req.valid("json");

    // Ensure system categories exist for this user (backfill for older accounts)
    await ensureSystemCategories(userId);

    const result = await processBillCsv(
      userId,
      {
        creditCardId: body.creditCardId,
        closingDate: new Date(body.closingDate + "T12:00:00Z"),
        dueDate: new Date(body.dueDate + "T12:00:00Z"),
        csvContent: body.csvContent,
        csvFileName: body.csvFileName,
        transactionId: body.transactionId,
      },
      prisma
    );

    return c.json(
      {
        bill: {
          id: result.bill.id,
          creditCardId: result.bill.creditCardId,
          closingDate: result.bill.closingDate.toISOString(),
          dueDate: result.bill.dueDate.toISOString(),
          totalAmount: result.bill.totalAmount,
          status: result.bill.status,
          categorizationStatus: result.bill.categorizationStatus,
        },
        totalAmount: result.totalAmount,
        transactionCount: result.transactionCount,
      },
      CREATED
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    if (message.includes("not found") || message.includes("No valid") || message.includes("CSV must")) {
      return c.json({ error: { code: "BAD_REQUEST", message } }, BAD_REQUEST);
    }
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
