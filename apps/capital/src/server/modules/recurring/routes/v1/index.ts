import { createRouter } from "@capital/server/lib/create-app";

import * as getRecurring from "./get-recurring";
import * as postRecurring from "./post-recurring";
import * as postToggle from "./post-toggle";
import * as deleteRecurring from "./delete-recurring";

const router = createRouter()
  .openapi(getRecurring.route, getRecurring.handler)
  .openapi(postRecurring.route, postRecurring.handler)
  .openapi(postToggle.route, postToggle.handler)
  .openapi(deleteRecurring.route, deleteRecurring.handler);

export default router;
