import { createRouter } from "@capital/server/lib/create-app";
import { authMiddleware } from "@capital/server/lib/auth-middleware";

import * as getBudgets from "./get-budgets";
import * as getBudgetProgress from "./get-budget-progress";
import * as postBudget from "./post-budget";
import * as putBudget from "./put-budget";
import * as deleteBudget from "./delete-budget";

const router = createRouter();

// Apply auth middleware to all routes
router.use("*", authMiddleware);

// Register routes
router
  .openapi(getBudgets.route, getBudgets.handler)
  .openapi(getBudgetProgress.route, getBudgetProgress.handler)
  .openapi(postBudget.route, postBudget.handler)
  .openapi(putBudget.route, putBudget.handler)
  .openapi(deleteBudget.route, deleteBudget.handler);

export default router;
