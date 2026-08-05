import { createRoute, z } from "@hono/zod-openapi";
import { NOT_FOUND, OK } from "stoker/http-status-codes";
import { jsonContent, jsonContentRequired } from "stoker/openapi/helpers";

import { createRouter } from "@pipeline/server/lib/create-app";
import { prisma } from "@pipeline/server/lib/prisma";
import { dateKey } from "@pipeline/server/lib/dates";
import type { AppRouteHandler } from "@pipeline/server/types";

// Manual spend entry — the insurance policy while ads API tokens don't exist
// (Google's developer-token approval can take weeks). Same table as API rows,
// synthetic keys so re-submitting a day EDITS it; API rows are authoritative
// once live and the UI warns loudly when both exist for the same day.
const ManualSpendSchema = z.object({
  ideaSlug: z.string(),
  channel: z.enum(["META", "GOOGLE"]),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spend: z.number().min(0), // BRL
  impressions: z.number().int().min(0),
  clicks: z.number().int().min(0),
  campaignName: z.string().default("manual"),
});

export const manualRoute = createRoute({
  path: "/v1/ad-spend/manual",
  method: "post",
  tags: ["AdSpend"],
  summary: "Manually enter a day of ad spend for an idea/channel",
  request: {
    body: jsonContentRequired(ManualSpendSchema, "One day of raw counts"),
  },
  responses: {
    [OK]: jsonContent(
      z.object({ ok: z.boolean(), overlapsApi: z.boolean() }),
      "Upserted",
    ),
    [NOT_FOUND]: jsonContent(z.object({ message: z.string() }), "Unknown idea"),
  },
});

export const manualHandler: AppRouteHandler<typeof manualRoute> = async (c) => {
  const body = c.req.valid("json");

  const idea = await prisma.idea.findUnique({
    where: { slug: body.ideaSlug },
    select: { id: true },
  });
  if (!idea) return c.json({ message: "unknown idea" }, NOT_FOUND);

  const date = dateKey(body.date);

  await prisma.adSpendDaily.upsert({
    where: {
      channel_accountId_campaignId_date: {
        channel: body.channel,
        accountId: `manual:${idea.id}`,
        campaignId: "manual",
        date,
      },
    },
    create: {
      ideaId: idea.id,
      channel: body.channel,
      accountId: `manual:${idea.id}`,
      campaignId: "manual",
      campaignName: body.campaignName,
      date,
      spendCents: Math.round(body.spend * 100),
      impressions: body.impressions,
      clicks: body.clicks,
      source: "MANUAL",
    },
    update: {
      campaignName: body.campaignName,
      spendCents: Math.round(body.spend * 100),
      impressions: body.impressions,
      clicks: body.clicks,
    },
  });

  // Double-counting trap: API rows for the same idea/channel/day mean this
  // manual row should be deleted — surface it immediately.
  const overlapsApi =
    (await prisma.adSpendDaily.count({
      where: { ideaId: idea.id, channel: body.channel, date, source: "API" },
    })) > 0;

  return c.json({ ok: true, overlapsApi }, OK);
};

const DeleteManualSchema = z.object({
  ideaSlug: z.string(),
  channel: z.enum(["META", "GOOGLE"]),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const deleteManualRoute = createRoute({
  path: "/v1/ad-spend/manual/delete",
  method: "post",
  tags: ["AdSpend"],
  summary: "Delete manual spend rows in a date range (after API rows arrive)",
  request: {
    body: jsonContentRequired(DeleteManualSchema, "Range to clear"),
  },
  responses: {
    [OK]: jsonContent(z.object({ deleted: z.number() }), "Deleted count"),
    [NOT_FOUND]: jsonContent(z.object({ message: z.string() }), "Unknown idea"),
  },
});

export const deleteManualHandler: AppRouteHandler<typeof deleteManualRoute> = async (
  c,
) => {
  const body = c.req.valid("json");
  const idea = await prisma.idea.findUnique({
    where: { slug: body.ideaSlug },
    select: { id: true },
  });
  if (!idea) return c.json({ message: "unknown idea" }, NOT_FOUND);

  const { count } = await prisma.adSpendDaily.deleteMany({
    where: {
      ideaId: idea.id,
      channel: body.channel,
      source: "MANUAL",
      date: { gte: dateKey(body.from), lte: dateKey(body.to) },
    },
  });
  return c.json({ deleted: count }, OK);
};

const router = createRouter()
  .openapi(manualRoute, manualHandler)
  .openapi(deleteManualRoute, deleteManualHandler);

export default router;
