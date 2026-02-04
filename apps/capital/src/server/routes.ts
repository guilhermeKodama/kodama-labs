import type { AppOpenAPI } from "./types";

import v1Health from "./modules/health/routes/v1";
import v1Auth from "./modules/auth/routes/v1";
import v1Users from "./modules/users/routes/v1";
import v1Businesses from "./modules/businesses/routes/v1";
import v1Transactions from "./modules/transactions/routes/v1";
import v1Transfers from "./modules/transfers/routes/v1";
import v1Categories from "./modules/categories/routes/v1";
import v1Currencies from "./modules/currencies/routes/v1";
import v1Budgets from "./modules/budgets/routes/v1";
import v1Recurring from "./modules/recurring/routes/v1";
import v1Reports from "./modules/reports/routes/v1";

export function registerRoutes(app: AppOpenAPI) {
  const routes = [
    v1Health,
    v1Auth,
    v1Users,
    v1Businesses,
    v1Transactions,
    v1Transfers,
    v1Categories,
    v1Currencies,
    v1Budgets,
    v1Recurring,
    v1Reports,
  ] as const;

  routes.forEach((route) => {
    app.route("/", route);
  });

  return routes;
}
