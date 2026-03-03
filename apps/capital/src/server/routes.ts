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
import v1RecurringTransfers from "./modules/recurring-transfers/routes/v1";
import v1Reports from "./modules/reports/routes/v1";
import v1CreditCards from "./modules/credit-cards/routes/v1";
import v1Investments from "./modules/investments/routes/v1";
import v1BankStatements from "./modules/bank-statements/routes/v1";

export function registerRoutes<T extends AppOpenAPI>(app: T) {
  return app
    .route("/", v1Health)
    .route("/", v1Auth)
    .route("/", v1Users)
    .route("/", v1Businesses)
    .route("/", v1Transactions)
    .route("/", v1Transfers)
    .route("/", v1Categories)
    .route("/", v1Currencies)
    .route("/", v1Budgets)
    .route("/", v1Recurring)
    .route("/", v1RecurringTransfers)
    .route("/", v1Reports)
    .route("/", v1CreditCards)
    .route("/", v1Investments)
    .route("/", v1BankStatements);
}
