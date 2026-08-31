import { createRouter } from "@capital/server/lib/create-app";

import * as postSubscribe from "./post-subscribe";
import * as deleteSubscribe from "./delete-subscribe";
import * as getStatus from "./get-status";

const router = createRouter()
  .openapi(postSubscribe.route, postSubscribe.handler)
  .openapi(deleteSubscribe.route, deleteSubscribe.handler)
  .openapi(getStatus.route, getStatus.handler);

export default router;
