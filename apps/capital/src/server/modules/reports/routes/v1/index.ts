import { createRouter } from "@capital/server/lib/create-app";
import { authMiddleware } from "@capital/server/lib/auth-middleware";

import * as getSummary from "./get-summary";
import * as getTax from "./get-tax";

const router = createRouter();

// Apply auth middleware to all routes
router.use("*", authMiddleware);

// Register routes
router
  .openapi(getSummary.route, getSummary.handler)
  .openapi(getTax.route, getTax.handler);

export default router;
