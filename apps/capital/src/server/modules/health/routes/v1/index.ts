import { createRouter } from "@capital/server/lib/router";

import * as getHealth from "./get-health";

const router = createRouter().openapi(getHealth.route, getHealth.handler);

export default router;
