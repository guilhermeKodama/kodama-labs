import { createRouter } from "@sentinel/server/lib/create-app";

import * as listProcurements from "./list-procurements";

const router = createRouter().openapi(
  listProcurements.route,
  listProcurements.handler
);

export default router;
