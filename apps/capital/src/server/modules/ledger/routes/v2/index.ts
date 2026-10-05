import { createRouter } from "@capital/server/lib/router";
import { ledgerAccountRoutes } from "./accounts";
import { ledgerBulkRoutes } from "./bulk";
import { ledgerEntityRoutes } from "./entities";
import { ledgerEntryRoutes } from "./entries";
import { ledgerMutationRoutes } from "./mutations";
import { ledgerQueryRoutes } from "./query";
import { ledgerRuleRoutes } from "./rules";
import { ledgerStatementRoutes } from "./statements";
import { ledgerTrashRoutes } from "./trash";
import { ledgerViewRoutes } from "./views";

/** The v2 ledger API, one router per resource. Every route keeps its full /v2/... path. */
const router = createRouter()
  .route("/", ledgerQueryRoutes)
  .route("/", ledgerEntryRoutes)
  .route("/", ledgerBulkRoutes)
  .route("/", ledgerMutationRoutes)
  .route("/", ledgerTrashRoutes)
  .route("/", ledgerViewRoutes)
  .route("/", ledgerEntityRoutes)
  .route("/", ledgerAccountRoutes)
  .route("/", ledgerStatementRoutes)
  .route("/", ledgerRuleRoutes);

export default router;
