import { createRoute, z } from "@hono/zod-openapi";
import {
  NOT_FOUND,
  OK,
  UNPROCESSABLE_ENTITY,
} from "stoker/http-status-codes";
import { jsonContent, jsonContentRequired } from "stoker/openapi/helpers";

import { createRouter } from "@pipeline/server/lib/create-app";
import { prisma } from "@pipeline/server/lib/prisma";
import type { AppRouteHandler } from "@pipeline/server/types";
import { LEAD_STATUSES } from "@/lib/funnel/lead-status";
import type { LeadStatus, Prisma } from "@/generated/prisma";
import { InvalidTransitionError, transitionLead } from "../../service";
import {
  importLeads,
  importLeadsPayloadSchema,
} from "@pipeline/server/modules/sync/import-leads";

const LeadStatusEnum = z.enum(LEAD_STATUSES);

const LeadSchema = z.object({
  id: z.string(),
  ideaSlug: z.string(),
  email: z.string(),
  contact: z.string().nullable(),
  name: z.string().nullable(),
  status: LeadStatusEnum,
  channel: z.string(),
  utmSource: z.string(),
  utmCampaign: z.string(),
  utmContent: z.string(),
  notes: z.string().nullable(),
  formData: z.record(z.unknown()),
  attributes: z.record(z.unknown()),
  resubmitCount: z.number(),
  createdAt: z.string(),
  activatedAt: z.string().nullable(),
  convertedAt: z.string().nullable(),
});

const ListQuerySchema = z.object({
  idea: z.string().optional(),
  status: LeadStatusEnum.optional(),
  utm_source: z.string().optional(),
  search: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

export const listRoute = createRoute({
  path: "/v1/leads",
  method: "get",
  tags: ["Leads"],
  summary: "List leads",
  request: { query: ListQuerySchema },
  responses: {
    [OK]: jsonContent(
      z.object({
        data: z.array(LeadSchema),
        total: z.number(),
        nextCursor: z.string().nullable(),
      }),
      "Leads",
    ),
  },
});

function serialize(
  lead: Prisma.LeadGetPayload<{ include: { idea: { select: { slug: true } } } }>,
) {
  return {
    id: lead.id,
    ideaSlug: lead.idea.slug,
    email: lead.email,
    contact: lead.contact,
    name: lead.name,
    status: lead.status as (typeof LEAD_STATUSES)[number],
    channel: lead.channel,
    utmSource: lead.utmSource,
    utmCampaign: lead.utmCampaign,
    utmContent: lead.utmContent,
    notes: lead.notes,
    formData: (lead.formData ?? {}) as Record<string, unknown>,
    attributes: (lead.attributes ?? {}) as Record<string, unknown>,
    resubmitCount: lead.resubmitCount,
    createdAt: lead.createdAt.toISOString(),
    activatedAt: lead.activatedAt?.toISOString() ?? null,
    convertedAt: lead.convertedAt?.toISOString() ?? null,
  };
}

export const listHandler: AppRouteHandler<typeof listRoute> = async (c) => {
  const q = c.req.valid("query");

  const where: Prisma.LeadWhereInput = {
    ...(q.idea ? { idea: { slug: q.idea } } : {}),
    ...(q.status ? { status: q.status as LeadStatus } : {}),
    ...(q.utm_source ? { utmSource: q.utm_source } : {}),
    ...(q.search
      ? {
          OR: [
            { email: { contains: q.search, mode: "insensitive" } },
            { contact: { contains: q.search, mode: "insensitive" } },
            { name: { contains: q.search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const [total, rows] = await Promise.all([
    prisma.lead.count({ where }),
    prisma.lead.findMany({
      where,
      include: { idea: { select: { slug: true } } },
      orderBy: { createdAt: "desc" },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    }),
  ]);

  const hasMore = rows.length > q.limit;
  const page = hasMore ? rows.slice(0, q.limit) : rows;

  return c.json(
    {
      data: page.map(serialize),
      total,
      nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
    },
    OK,
  );
};

const PatchBodySchema = z
  .object({
    status: LeadStatusEnum.optional(),
    notes: z.string().max(2000).optional(),
    note: z.string().max(500).optional(), // transition note (audit trail)
    force: z.boolean().default(false),
    attributes: z.record(z.union([z.string(), z.number()])).optional(),
  })
  .refine(
    (b) => b.status || b.notes !== undefined || b.attributes,
    "nothing to update",
  );

export const patchRoute = createRoute({
  path: "/v1/leads/{id}",
  method: "patch",
  tags: ["Leads"],
  summary: "Update lead status / notes / attributes",
  request: {
    params: z.object({ id: z.string() }),
    body: jsonContentRequired(PatchBodySchema, "Fields to update"),
  },
  responses: {
    [OK]: jsonContent(LeadSchema, "Updated lead"),
    [NOT_FOUND]: jsonContent(z.object({ message: z.string() }), "Lead not found"),
    [UNPROCESSABLE_ENTITY]: jsonContent(
      z.object({ message: z.string() }),
      "Invalid transition",
    ),
  },
});

export const patchHandler: AppRouteHandler<typeof patchRoute> = async (c) => {
  const { id } = c.req.valid("param");
  const body = c.req.valid("json");

  const existing = await prisma.lead.findUnique({ where: { id } });
  if (!existing) return c.json({ message: "lead not found" }, NOT_FOUND);

  try {
    if (body.status && body.status !== existing.status) {
      await transitionLead(id, body.status as LeadStatus, {
        note: body.note,
        force: body.force,
        actor: "ui",
      });
    }
    if (body.notes !== undefined || body.attributes) {
      await prisma.lead.update({
        where: { id },
        data: {
          ...(body.notes !== undefined ? { notes: body.notes } : {}),
          ...(body.attributes
            ? {
                attributes: {
                  ...((existing.attributes ?? {}) as Record<string, unknown>),
                  ...body.attributes,
                } as Prisma.InputJsonValue,
              }
            : {}),
        },
      });
    }
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return c.json({ message: err.message }, UNPROCESSABLE_ENTITY);
    }
    throw err;
  }

  const updated = await prisma.lead.findUniqueOrThrow({
    where: { id },
    include: { idea: { select: { slug: true } } },
  });
  return c.json(serialize(updated), OK);
};

// UI-facing CSV import (the /ops uploader posts here, behind dashboard auth).
// The CLI uses /sync/import-leads with SYNC_SECRET; both call the same service.
export const importRoute = createRoute({
  path: "/v1/leads/import",
  method: "post",
  tags: ["Leads"],
  summary: "Import leads from a parsed CSV",
  request: {
    body: jsonContentRequired(importLeadsPayloadSchema, "Parsed CSV rows"),
  },
  responses: {
    [OK]: jsonContent(
      z.object({
        ok: z.boolean(),
        created: z.number().optional(),
        updated: z.number().optional(),
        skipped: z.number().optional(),
        errors: z.array(z.string()).optional(),
        error: z.string().optional(),
      }),
      "Import result",
    ),
    [UNPROCESSABLE_ENTITY]: jsonContent(
      z.object({ message: z.string() }),
      "Invalid payload",
    ),
  },
});

export const importHandler: AppRouteHandler<typeof importRoute> = async (c) => {
  const result = await importLeads(c.req.valid("json"));
  return c.json(result, OK);
};

const router = createRouter()
  .openapi(listRoute, listHandler)
  .openapi(patchRoute, patchHandler)
  .openapi(importRoute, importHandler);

export default router;
