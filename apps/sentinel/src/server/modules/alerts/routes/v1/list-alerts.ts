import { createRoute, z } from "@hono/zod-openapi";
import { OK } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@sentinel/server/types";
import { prisma } from "@sentinel/server/lib/prisma";

const AlertSchema = z.object({
  id: z.string(),
  type: z.string(),
  severity: z.string(),
  title: z.string(),
  description: z.string(),
  procurementId: z.string().nullable(),
  contractId: z.string().nullable(),
  entityId: z.string().nullable(),
  data: z.any(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});

const ResponseSchema = z.object({
  data: z.array(AlertSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const route = createRoute({
  path: "/v1/alerts",
  method: "get",
  tags: ["Alerts"],
  summary: "List alerts",
  request: {
    query: z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
      type: z.string().optional(),
      severity: z.string().optional(),
      unresolvedOnly: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "List of alerts"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const { page, pageSize, type, severity, unresolvedOnly } =
    c.req.valid("query");

  const where = {
    ...(type && { type: type as "OVERPRICING" | "SHELL_COMPANY" | "SANCTIONED_ENTITY" | "SUSPICIOUS_NETWORK" | "AI_FLAG" }),
    ...(severity && { severity: severity as "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" }),
    ...(unresolvedOnly && { resolvedAt: null }),
  };

  const [data, total] = await Promise.all([
    prisma.alert.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.alert.count({ where }),
  ]);

  return c.json(
    {
      data: data.map((a) => ({
        ...a,
        createdAt: a.createdAt.toISOString(),
        resolvedAt: a.resolvedAt?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize,
    },
    OK
  );
};
