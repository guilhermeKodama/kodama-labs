import { createRouter } from "@capital/server/lib/create-app";

import * as getBudgets from "./get-budgets";
import * as getBudgetProgress from "./get-budget-progress";
import * as getBudgetDashboard from "./get-budget-dashboard";
import * as postBudget from "./post-budget";
import * as putBudget from "./put-budget";
import * as deleteBudget from "./delete-budget";

const router = createRouter()
  .openapi(getBudgets.route, getBudgets.handler)
  .openapi(getBudgetProgress.route, getBudgetProgress.handler)
  .openapi(getBudgetDashboard.route, getBudgetDashboard.handler)
  .openapi(postBudget.route, postBudget.handler)
  .openapi(putBudget.route, putBudget.handler)
  .openapi(deleteBudget.route, deleteBudget.handler);

export default router;
