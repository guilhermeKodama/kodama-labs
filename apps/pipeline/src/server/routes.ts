import type { AppOpenAPI } from "./types";

import v1AdSpend from "./modules/ad-spend/routes/v1";
import v1Health from "./modules/health/routes/v1";
import v1Ideas from "./modules/ideas/routes/v1";
import v1Leads from "./modules/leads/routes/v1";
import syncRoutes from "./modules/sync/routes";
import webhookRoutes from "./modules/webhooks/routes";

export function registerRoutes<T extends AppOpenAPI>(app: T) {
  return app
    .route("/", v1Health)
    .route("/", v1Ideas)
    .route("/", v1Leads)
    .route("/", v1AdSpend)
    .route("/", syncRoutes)
    .route("/", webhookRoutes);
}
