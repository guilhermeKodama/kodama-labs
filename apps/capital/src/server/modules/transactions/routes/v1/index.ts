import { createRouter } from "@capital/server/lib/create-app";
import { authMiddleware } from "@capital/server/lib/auth-middleware";

import * as getTransactions from "./get-transactions";
import * as postTransaction from "./post-transaction";
import * as putTransaction from "./put-transaction";
import * as deleteTransaction from "./delete-transaction";

const router = createRouter();

// Apply auth middleware to all routes
router.use("*", authMiddleware);

// Register routes
router
  .openapi(getTransactions.route, getTransactions.handler)
  .openapi(postTransaction.route, postTransaction.handler)
  .openapi(putTransaction.route, putTransaction.handler)
  .openapi(deleteTransaction.route, deleteTransaction.handler);

export default router;
