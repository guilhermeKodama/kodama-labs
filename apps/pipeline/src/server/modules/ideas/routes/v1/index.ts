import { createRoute, z } from "@hono/zod-openapi";
import { NOT_FOUND, OK } from "stoker/http-status-codes";
import { jsonContent, jsonContentRequired } from "stoker/openapi/helpers";

import { createRouter } from "@pipeline/server/lib/create-app";
import { prisma } from "@pipeline/server/lib/prisma";
import type { AppRouteHandler } from "@pipeline/server/types";
import { isManualGate, parseGates } from "@/lib/funnel/gates";
import type { Prisma } from "@/generated/prisma";

// Manual gate checklist state lives on the Idea's gates JSON (checkedAt per
// label). The sync service preserves it across config re-syncs by label match.
const GateCheckSchema = z.object({
  section: z.enum(["go", "pivot", "kill"]),
  label: z.string().min(1),
  checked: z.boolean(),
});

export const gateCheckRoute = createRoute({
  path: "/v1/ideas/{slug}/gates",
  method: "patch",
  tags: ["Ideas"],
  summary: "Check/uncheck a manual gate item",
  request: {
    params: z.object({ slug: z.string() }),
    body: jsonContentRequired(GateCheckSchema, "Gate item to toggle"),
  },
  responses: {
    [OK]: jsonContent(z.object({ ok: z.boolean() }), "Updated"),
    [NOT_FOUND]: jsonContent(z.object({ message: z.string() }), "Not found"),
  },
});

export const gateCheckHandler: AppRouteHandler<typeof gateCheckRoute> = async (c) => {
  const { slug } = c.req.valid("param");
  const body = c.req.valid("json");

  const idea = await prisma.idea.findUnique({
    where: { slug },
    select: { id: true, gates: true },
  });
  if (!idea) return c.json({ message: "unknown idea" }, NOT_FOUND);

  const gates = parseGates(idea.gates);
  if (!gates) return c.json({ message: "idea has no gates" }, NOT_FOUND);

  const item = gates[body.section].find(
    (g) => isManualGate(g) && g.label === body.label,
  );
  if (!item || !isManualGate(item)) {
    return c.json({ message: "gate item not found" }, NOT_FOUND);
  }

  item.checkedAt = body.checked ? new Date().toISOString() : null;

  await prisma.idea.update({
    where: { id: idea.id },
    data: { gates: gates as unknown as Prisma.InputJsonValue },
  });

  return c.json({ ok: true }, OK);
};

const router = createRouter().openapi(gateCheckRoute, gateCheckHandler);

export default router;
