import { createRouter } from "@capital/server/lib/create-app";

import * as getUser from "./get-user";
import * as putUser from "./put-user";

const router = createRouter()
  .openapi(getUser.route, getUser.handler)
  .openapi(putUser.route, putUser.handler);

export default router;
