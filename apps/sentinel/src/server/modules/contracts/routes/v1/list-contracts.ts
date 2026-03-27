import { createRoute, z } from "@hono/zod-openapi";
import { OK } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@sentinel/server/types";
import { prisma } from "@sentinel/server/lib/prisma";

const ContractSchema = z.object({
  id: z.string(),
  externalId: z.string(),
  supplierCnpj: z.string(),
  supplierName: z.string(),
  value: z.string(),
  startDate: z.string(),
  endDate: z.string().nullable(),
  description: z.string(),
  procurementId: z.string().nullable(),
});

const ResponseSchema = z.object({
  data: z.array(ContractSchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const route = createRoute({
  path: "/v1/contracts",
  method: "get",
  tags: ["Contracts"],
  summary: "List contracts",
  request: {
    query: z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
      supplierCnpj: z.string().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "List of contracts"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const { page, pageSize, supplierCnpj } = c.req.valid("query");

  const where = {
    ...(supplierCnpj && { supplierCnpj }),
  };

  const [data, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      orderBy: { startDate: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.contract.count({ where }),
  ]);

  return c.json(
    {
      data: data.map((c) => ({
        ...c,
        value: c.value.toString(),
        startDate: c.startDate.toISOString(),
        endDate: c.endDate?.toISOString() ?? null,
      })),
      total,
      page,
      pageSize,
    },
    OK
  );
};
