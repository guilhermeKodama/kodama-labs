import { createRoute, z } from "@hono/zod-openapi";
import { OK, BAD_REQUEST, NOT_FOUND, UNAUTHORIZED, INTERNAL_SERVER_ERROR } from "stoker/http-status-codes";
import { jsonContent } from "stoker/openapi/helpers";

import type { AppRouteHandler } from "@capital/server/types";
import { prisma } from "@capital/server/lib/prisma";
import { requireUserId } from "@capital/server/lib/auth-middleware";
import { ApiErrorSchema } from "@capital/server/lib/http-error";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { fetchImportPlanById } from "../../data/queries/fetch-import-plan";
import { updateImportPlanStatus } from "../../data/commands/update-import-plan";
import { routeConfig } from "../../constants";

const ConfirmRequestSchema = z.object({ payloadHash: z.string() });
const PlanStatusResponseSchema = z.object({ planId: z.string(), status: z.string() });

// ---------------------------------------------------------------------------
// This is THE security boundary of the whole feature: the only place a
// plan's status can become "confirmed", which is the only precondition
// commit_plan (an agent tool) accepts before writing domain data. Nothing
// inside a chat turn - no text the model emits, no text hidden in an
// uploaded file - can reach this code path. Only an authenticated browser
// request, echoing the exact payloadHash the UI rendered, can.
// ---------------------------------------------------------------------------

export const confirmRoute = createRoute({
  path: "/v1/assistant/conversations/{id}/plans/{planId}/confirm",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Confirm an import/revert plan",
  description:
    "The only way a plan becomes committable. payloadHash must match exactly what the UI rendered - a stale or tampered plan is rejected.",
  request: {
    params: z.object({ id: z.string(), planId: z.string() }),
    body: jsonContent(ConfirmRequestSchema, "The hash of the payload the user is approving"),
  },
  responses: {
    [OK]: jsonContent(PlanStatusResponseSchema, "Plan confirmed"),
    [BAD_REQUEST]: jsonContent(ApiErrorSchema, "Hash mismatch or wrong status"),
    [NOT_FOUND]: jsonContent(ApiErrorSchema, "Plan not found"),
    [UNAUTHORIZED]: jsonContent(ApiErrorSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ApiErrorSchema, "Internal server error"),
  },
});

export const confirmHandler: AppRouteHandler<typeof confirmRoute> = async (c) => {
  const userId = requireUserId(c);
  const { planId } = c.req.valid("param");
  const { payloadHash } = c.req.valid("json");

  const plan = await fetchImportPlanById(userId, planId, prisma);
  if (!plan) {
    throw new LedgerError("Plan not found", 404, { code: "assistant.plan_not_found" });
  }
  if (plan.status !== "proposed") {
    throw new LedgerError(`Plan is "${plan.status}", not "proposed"`, 400, { code: "assistant.plan_not_proposed", params: { status: plan.status } });
  }
  if (plan.payloadHash !== payloadHash) {
    throw new LedgerError("payloadHash does not match - the plan changed since it was displayed, re-read it before confirming", 400, {
      code: "assistant.plan_changed",
    });
  }

  const updated = await updateImportPlanStatus(
    userId,
    planId,
    "confirmed",
    { confirmedAt: new Date(), confirmedVia: "ui_button" },
    prisma
  );

  return c.json({ planId: updated.id, status: updated.status }, OK);
};

export const rejectRoute = createRoute({
  path: "/v1/assistant/conversations/{id}/plans/{planId}/reject",
  method: "post",
  tags: [...routeConfig.v1.defaultTags],
  summary: "Reject an import/revert plan",
  description: "Marks a proposed plan as rejected - it can never be confirmed or committed after this.",
  request: {
    params: z.object({ id: z.string(), planId: z.string() }),
  },
  responses: {
    [OK]: jsonContent(PlanStatusResponseSchema, "Plan rejected"),
    [BAD_REQUEST]: jsonContent(ApiErrorSchema, "Wrong status"),
    [NOT_FOUND]: jsonContent(ApiErrorSchema, "Plan not found"),
    [UNAUTHORIZED]: jsonContent(ApiErrorSchema, "Not authenticated"),
    [INTERNAL_SERVER_ERROR]: jsonContent(ApiErrorSchema, "Internal server error"),
  },
});

export const rejectHandler: AppRouteHandler<typeof rejectRoute> = async (c) => {
  const userId = requireUserId(c);
  const { planId } = c.req.valid("param");

  const plan = await fetchImportPlanById(userId, planId, prisma);
  if (!plan) {
    throw new LedgerError("Plan not found", 404, { code: "assistant.plan_not_found" });
  }
  if (plan.status !== "proposed") {
    throw new LedgerError(`Plan is "${plan.status}", not "proposed"`, 400, { code: "assistant.plan_not_proposed", params: { status: plan.status } });
  }

  const updated = await updateImportPlanStatus(userId, planId, "rejected", {}, prisma);
  return c.json({ planId: updated.id, status: updated.status }, OK);
};
