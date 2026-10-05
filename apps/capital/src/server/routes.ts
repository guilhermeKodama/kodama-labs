import type { AppOpenAPI } from "./types";

import v1Health from "./modules/health/routes/v1";
import v1Fire from "./modules/fire/routes/v1";
import v1Assistant from "./modules/assistant/routes/v1";
import v1Push from "./modules/push/routes/v1";
import v2Ledger from "./modules/ledger/routes/v2";
import { v2Auth } from "./modules/auth/routes/v2";
import { v2Attachments } from "./modules/attachments/routes/v2";
import { v2Budgets } from "./modules/budgets/routes/v2";
import { v2Categories } from "./modules/categories/routes/v2";
import { v2Currencies } from "./modules/currencies/routes/v2";
import { v2Imports } from "./modules/bank-statements/routes/v2";
import { v2Investments } from "./modules/investments/routes/v2";
import { v2Recurring } from "./modules/recurring/routes/v2";

export function registerRoutes<T extends AppOpenAPI>(app: T) {
  return app
    .route("/", v1Health)
    .route("/", v1Fire)
    .route("/", v1Assistant)
    .route("/", v1Push)
    .route("/", v2Ledger)
    .route("/", v2Auth)
    .route("/", v2Attachments)
    .route("/", v2Budgets)
    .route("/", v2Categories)
    .route("/", v2Currencies)
    .route("/", v2Imports)
    .route("/", v2Investments)
    .route("/", v2Recurring);
}
