import { createRouter } from "@capital/server/lib/create-app";

import * as getUser from "./get-user";
import * as putUser from "./put-user";
import * as patchInitialBalance from "./patch-initial-balance";

const router = createRouter()
  .openapi(getUser.route, getUser.handler)
  .openapi(putUser.route, putUser.handler)
  .openapi(patchInitialBalance.route, patchInitialBalance.handler);

export default router;
