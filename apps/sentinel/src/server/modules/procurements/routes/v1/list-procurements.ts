import { createRoute, z } from "@hono/zod-openapi";
import { OK } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@sentinel/server/types";
import { prisma } from "@sentinel/server/lib/prisma";

const ProcurementSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  source: z.string(),
  orgCnpj: z.string(),
  orgName: z.string(),
  year: z.number(),
  number: z.string(),
  modality: z.string(),
  description: z.string(),
  publishedAt: z.string(),
  status: z.string(),
  totalValue: z.string().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  riskScore: z.number().nullable(),
});

const ResponseSchema = z.object({
  data: z.array(ProcurementSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const route = createRoute({
  path: "/v1/procurements",
  method: "get",
  tags: ["Procurements"],
  summary: "List procurements",
  request: {
    query: z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
      state: z.string().optional(),
      city: z.string().optional(),
      source: z.string().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "List of procurements"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const { page, pageSize, state, city, source } = c.req.valid("query");

  const where = {
    ...(state && { state }),
    ...(city && { city }),
    ...(source && { source: source as "PNCP" | "TRANSPARENCIA" | "COMPRAS_GOV" }),
  };

  const [data, total] = await Promise.all([
    prisma.procurement.findMany({
      where,
      orderBy: { publishedAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.procurement.count({ where }),
  ]);

  return c.json(
    {
      data: data.map((p) => ({
        ...p,
        publishedAt: p.publishedAt.toISOString(),
        totalValue: p.totalValue?.toString() ?? null,
      })),
      total,
      page,
      pageSize,
    },
    OK
  );
};
