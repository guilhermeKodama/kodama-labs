import { createRouter } from "@sentinel/server/lib/create-app";

import * as listAlerts from "./list-alerts";

const router = createRouter().openapi(listAlerts.route, listAlerts.handler);

export default router;
