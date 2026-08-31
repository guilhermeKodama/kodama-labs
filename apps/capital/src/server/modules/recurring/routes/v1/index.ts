import { createRouter } from "@capital/server/lib/create-app";

import * as getRecurring from "./get-recurring";
import * as postRecurring from "./post-recurring";
import * as putRecurring from "./put-recurring";
import * as deleteRecurring from "./delete-recurring";
import * as postToggle from "./post-toggle";
import * as postMarkPaid from "./post-mark-paid";
import * as postSkip from "./post-skip";

const router = createRouter()
  .openapi(getRecurring.route, getRecurring.handler)
  .openapi(postRecurring.route, postRecurring.handler)
  .openapi(putRecurring.route, putRecurring.handler)
  .openapi(deleteRecurring.route, deleteRecurring.handler)
  .openapi(postToggle.route, postToggle.handler)
  .openapi(postMarkPaid.route, postMarkPaid.handler)
  .openapi(postSkip.route, postSkip.handler);

export default router;
