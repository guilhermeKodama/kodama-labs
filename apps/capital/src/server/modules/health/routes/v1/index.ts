import { createRouter } from "@capital/server/lib/create-app";

import * as getHealth from "./get-health";

const router = createRouter().openapi(getHealth.route, getHealth.handler);

export default router;
