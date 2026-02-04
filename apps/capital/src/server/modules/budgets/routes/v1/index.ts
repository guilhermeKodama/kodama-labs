import { createRouter } from "@capital/server/lib/create-app";

import * as getBudgets from "./get-budgets";
import * as postBudget from "./post-budget";
import * as getBudgetProgress from "./get-budget-progress";
import * as deleteBudget from "./delete-budget";

const router = createRouter()
  .openapi(getBudgets.route, getBudgets.handler)
  .openapi(postBudget.route, postBudget.handler)
  .openapi(getBudgetProgress.route, getBudgetProgress.handler)
  .openapi(deleteBudget.route, deleteBudget.handler);

export default router;
