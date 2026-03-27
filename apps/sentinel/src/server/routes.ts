import type { AppOpenAPI } from "./types";

import v1Health from "./modules/health/routes/v1";
import v1Procurements from "./modules/procurements/routes/v1";
import v1Contracts from "./modules/contracts/routes/v1";
import v1Entities from "./modules/entities/routes/v1";
import v1Alerts from "./modules/alerts/routes/v1";

export function registerRoutes<T extends AppOpenAPI>(app: T) {
  return app
    .route("/", v1Health)
    .route("/", v1Procurements)
    .route("/", v1Contracts)
    .route("/", v1Entities)
    .route("/", v1Alerts);
}
