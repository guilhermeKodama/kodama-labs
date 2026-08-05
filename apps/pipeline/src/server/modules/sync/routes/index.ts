import { createRoute, z } from "@hono/zod-openapi";
import { OK, UNAUTHORIZED, UNPROCESSABLE_ENTITY } from "stoker/http-status-codes";
import { jsonContent, jsonContentRequired } from "stoker/openapi/helpers";

import { env } from "@/env";
import { createRouter } from "@pipeline/server/lib/create-app";
import type { AppRouteHandler } from "@pipeline/server/types";
import { importLeads, importLeadsPayloadSchema } from "../import-leads";
import { syncPayloadSchema } from "../schema";
import { syncIdeas } from "../service";

const SyncResponseSchema = z.object({
  results: z.array(
    z.object({
      slug: z.string(),
      action: z.enum(["created", "updated", "unchanged", "archived", "unarchived"]),
    }),
  ),
  syncedAt: z.string(),
});

const ErrorSchema = z.object({ message: z.string() });

export const route = createRoute({
  path: "/sync/ideas",
  method: "post",
  tags: ["Sync"],
  summary: "Sync ideas from the repo's idea.yaml snapshot",
  description:
    "Full-snapshot upsert keyed on slug. Bearer auth via SYNC_SECRET. CI runs (commitSha present) archive synced ideas missing from the snapshot; local runs are upsert-only.",
  request: {
    body: jsonContentRequired(syncPayloadSchema, "Snapshot of ideas/*/idea.yaml"),
  },
  responses: {
    [OK]: jsonContent(SyncResponseSchema, "Snapshot applied"),
    [UNAUTHORIZED]: jsonContent(ErrorSchema, "Missing or invalid bearer token"),
    [UNPROCESSABLE_ENTITY]: jsonContent(ErrorSchema, "Invalid payload"),
  },
});

export const handler: AppRouteHandler<typeof route> = async (c) => {
  const payload = c.req.valid("json");
  const result = await syncIdeas(payload);
  return c.json(result, OK);
};

export const importLeadsRoute = createRoute({
  path: "/sync/import-leads",
  method: "post",
  tags: ["Sync"],
  summary: "One-off import of leads from the Google Sheets tracker",
  request: {
    body: jsonContentRequired(importLeadsPayloadSchema, "Sheet rows"),
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
    [UNAUTHORIZED]: jsonContent(ErrorSchema, "Missing or invalid bearer token"),
    [UNPROCESSABLE_ENTITY]: jsonContent(ErrorSchema, "Invalid payload"),
  },
});

export const importLeadsHandler: AppRouteHandler<typeof importLeadsRoute> = async (
  c,
) => {
  const result = await importLeads(c.req.valid("json"));
  return c.json(result, OK);
};

const router = createRouter();

// Auth must run BEFORE body validation, otherwise unauthenticated requests
// leak schema details via 422 responses.
router.use("/sync/*", async (c, next) => {
  const secret = env.SYNC_SECRET;
  const auth = c.req.header("authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return c.json({ message: "unauthorized" }, UNAUTHORIZED);
  }
  await next();
});

router.openapi(route, handler);
router.openapi(importLeadsRoute, importLeadsHandler);

export default router;
