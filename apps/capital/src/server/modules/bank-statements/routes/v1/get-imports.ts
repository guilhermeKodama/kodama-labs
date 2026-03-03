import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { routeConfig } from "../../constants";

const ImportItemSchema = z.object({
  id: z.string(),
  entityType: z.enum(["personal", "business"]),
  bankName: z.string().nullable(),
  fileName: z.string().nullable(),
  transactionCount: z.number(),
  ledgerBalance: z.number().nullable(),
  ledgerCurrency: z.string().nullable(),
  personalAccountId: z.string().nullable(),
  businessId: z.string().nullable(),
  categorizationStatus: z.string(),
  createdAt: z.string(),
});

const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
  }),
});

export const route = createRoute({
  path: "/v1/bank-statements/imports",
  method: "get",
  tags: [...routeConfig.v1.defaultTags],
  summary: "List statement imports",
  description: "Returns recent statement imports for the user with categorization status",
  responses: {
    [OK]: jsonContent(z.array(ImportItemSchema), "Statement imports"),
    [UNAUTHORIZED]: jsonContent(ErrorResponseSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ErrorResponseSchema, "Internal server error"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  try {
    const userId = requireUserId(c);

    const imports = await prisma.statementImport.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      take: 20,
    });

    return c.json(
      imports.map((i) => ({
        id: i.id,
        entityType: i.entityType,
        bankName: i.bankName,
        fileName: i.fileName,
        transactionCount: i.transactionCount,
        ledgerBalance: i.ledgerBalance,
        ledgerCurrency: i.ledgerCurrency,
        personalAccountId: i.personalAccountId,
        businessId: i.businessId,
        categorizationStatus: i.categorizationStatus,
        createdAt: i.createdAt.toISOString(),
      })),
      OK
    );
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return c.json(
      { error: { code: "INTERNAL_ERROR", message } },
      INTERNAL_SERVER_ERROR
    );
  }
};
