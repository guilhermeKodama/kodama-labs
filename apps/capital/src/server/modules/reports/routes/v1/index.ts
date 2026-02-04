import { createRouter } from "@capital/server/lib/create-app";

import * as getSummary from "./get-summary";
import * as getTax from "./get-tax";

const router = createRouter()
  .openapi(getSummary.route, getSummary.handler)
  .openapi(getTax.route, getTax.handler);

export default router;
