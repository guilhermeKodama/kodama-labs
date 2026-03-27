import { createRoute, z } from "@hono/zod-openapi";
import { OK } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@sentinel/server/types";
import { prisma } from "@sentinel/server/lib/prisma";

const EntitySchema = z.object({
  id: z.string(),
  cnpj: z.string(),
  name: z.string(),
  tradeName: z.string().nullable(),
  openDate: z.string().nullable(),
  capital: z.string().nullable(),
  activityCode: z.string().nullable(),
  activityDesc: z.string().nullable(),
  state: z.string().nullable(),
  city: z.string().nullable(),
  riskScore: z.number().nullable(),
  isShellCompany: z.boolean(),
  contractCount: z.number(),
  sanctionCount: z.number(),
});

const ResponseSchema = z.object({
  data: z.array(EntitySchema),
  total: z.number(),
  page: z.number(),
  pageSize: z.number(),
});

export const route = createRoute({
  path: "/v1/entities",
  method: "get",
  tags: ["Entities"],
  summary: "List entities (companies)",
  request: {
    query: z.object({
      page: z.coerce.number().min(1).default(1),
      pageSize: z.coerce.number().min(1).max(100).default(20),
      state: z.string().optional(),
      shellOnly: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    [OK]: jsonContent(ResponseSchema, "List of entities"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const { page, pageSize, state, shellOnly } = c.req.valid("query");

  const where = {
    ...(state && { state }),
    ...(shellOnly && { isShellCompany: true }),
  };

  const [data, total] = await Promise.all([
    prisma.entity.findMany({
      where,
      include: {
        _count: { select: { contracts: true, sanctions: true } },
      },
      orderBy: { riskScore: { sort: "desc", nulls: "last" } },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.entity.count({ where }),
  ]);

  return c.json(
    {
      data: data.map((e) => ({
        id: e.id,
        cnpj: e.cnpj,
        name: e.name,
        tradeName: e.tradeName,
        openDate: e.openDate?.toISOString() ?? null,
        capital: e.capital?.toString() ?? null,
        activityCode: e.activityCode,
        activityDesc: e.activityDesc,
        state: e.state,
        city: e.city,
        riskScore: e.riskScore,
        isShellCompany: e.isShellCompany,
        contractCount: e._count.contracts,
        sanctionCount: e._count.sanctions,
      })),
      total,
      page,
      pageSize,
    },
    OK
  );
};
