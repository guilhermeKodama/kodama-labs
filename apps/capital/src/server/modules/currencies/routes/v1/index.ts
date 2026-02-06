import { createRouter } from "@capital/server/lib/create-app";
import { authMiddleware } from "@capital/server/lib/auth-middleware";

import * as getCurrencies from "./get-currencies";
import * as postCurrency from "./post-currency";
import * as putCurrency from "./put-currency";
import * as deleteCurrency from "./delete-currency";

const router = createRouter();

// Apply auth middleware to all routes
router.use("*", authMiddleware);

// Register routes
router
  .openapi(getCurrencies.route, getCurrencies.handler)
  .openapi(postCurrency.route, postCurrency.handler)
  .openapi(putCurrency.route, putCurrency.handler)
  .openapi(deleteCurrency.route, deleteCurrency.handler);

export default router;
