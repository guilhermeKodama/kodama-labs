import { createRouter } from "@capital/server/lib/create-app";
import { authMiddleware } from "@capital/server/lib/auth-middleware";

import * as getUser from "./get-user";
import * as putUser from "./put-user";

const router = createRouter();

// Apply auth middleware to all routes
router.use("*", authMiddleware);

// Register routes
router
  .openapi(getUser.route, getUser.handler)
  .openapi(putUser.route, putUser.handler);

export default router;
