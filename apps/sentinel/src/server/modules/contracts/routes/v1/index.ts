import { createRouter } from "@sentinel/server/lib/create-app";

import * as listContracts from "./list-contracts";

const router = createRouter().openapi(
  listContracts.route,
  listContracts.handler
);

export default router;
