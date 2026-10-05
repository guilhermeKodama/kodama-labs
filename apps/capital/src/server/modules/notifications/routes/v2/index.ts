import { createRouter } from "@capital/server/lib/router";

/**
 * Notification settings and push devices (/v2/notifications/...). Mounted
 * empty in src/server/routes.ts so the notifications slice only fills this
 * file: settings GET/PUT, GET /v2/notifications/devices?endpoint= (isCurrent)
 * and DELETE /v2/notifications/devices/{id}.
 */
export const v2Notifications = createRouter();
