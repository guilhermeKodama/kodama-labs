import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { isPushConfigured } from "@capital/server/lib/web-push";
import { listDevices, removeDevice } from "../../services/devices";
import { getNotificationSettings, updateNotificationSettings } from "../../services/settings";

const tags = ["Notifications v2"];

const settingsPatch = z
  .object({
    dueEnabled: z.boolean(),
    dueDaysBefore: z.number().int().min(0).max(30),
    dueHour: z.number().int().min(0).max(23),
    overdueEnabled: z.boolean(),
    billClosedEnabled: z.boolean(),
    budgetEnabled: z.boolean(),
    budgetThreshold: z.number().gt(0).max(2),
    weeklyEnabled: z.boolean(),
    weeklyDow: z.number().int().min(0).max(6),
    weeklyHour: z.number().int().min(0).max(23),
  })
  .partial()
  .strict();

const getSettingsRoute = createRoute({
  method: "get",
  path: "/v2/notifications/settings",
  tags,
  summary: "Which pushes the user receives (defaults until changed) and whether the server can send push at all (pushConfigured)",
  responses: v2Responses,
});
const patchSettingsRoute = createRoute({
  method: "patch",
  path: "/v2/notifications/settings",
  tags,
  summary: "Change notification toggles, the due reminder's offset and hour, the budget threshold or the weekly summary's day and hour",
  request: jsonBody(settingsPatch),
  responses: v2Responses,
});
const listDevicesRoute = createRoute({
  method: "get",
  path: "/v2/notifications/devices",
  tags,
  summary: "Devices with live push subscriptions; endpoint (this browser's subscription) marks the current one with isCurrent",
  request: { query: z.object({ endpoint: z.string().optional() }) },
  responses: v2Responses,
});
const deleteDeviceRoute = createRoute({
  method: "delete",
  path: "/v2/notifications/devices/{id}",
  tags,
  summary: "Stop pushes to a device (404 notifications.device_not_found for another user's device)",
  request: { params: idParams },
  responses: v2Responses,
});

/** Notification settings and push devices (/v2/notifications/...). */
export const v2Notifications = createRouter()
  .openapi(getSettingsRoute, v2Handler(getSettingsRoute, async (_c, userId) => ({ ...(await getNotificationSettings(userId, prisma)), pushConfigured: isPushConfigured() })))
  .openapi(patchSettingsRoute, v2Handler(patchSettingsRoute, async (c, userId) => ({ ...(await updateNotificationSettings(userId, c.req.valid("json"), prisma)), pushConfigured: isPushConfigured() })))
  .openapi(listDevicesRoute, v2Handler(listDevicesRoute, async (c, userId) => ({ pushConfigured: isPushConfigured(), devices: await listDevices(userId, prisma, c.req.valid("query").endpoint) })))
  .openapi(deleteDeviceRoute, v2Handler(deleteDeviceRoute, (c, userId) => removeDevice(userId, c.req.valid("param").id, prisma)));
