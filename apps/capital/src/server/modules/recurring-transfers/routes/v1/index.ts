import { createRouter } from "@capital/server/lib/create-app";

import * as getRecurringTransfers from "./get-recurring-transfers";
import * as postRecurringTransfer from "./post-recurring-transfer";
import * as putRecurringTransfer from "./put-recurring-transfer";
import * as postToggle from "./post-toggle";
import * as postMarkPaid from "./post-mark-paid";
import * as deleteRecurringTransfer from "./delete-recurring-transfer";

const router = createRouter()
  .openapi(getRecurringTransfers.route, getRecurringTransfers.handler)
  .openapi(postRecurringTransfer.route, postRecurringTransfer.handler)
  .openapi(putRecurringTransfer.route, putRecurringTransfer.handler)
  .openapi(postToggle.route, postToggle.handler)
  .openapi(postMarkPaid.route, postMarkPaid.handler)
  .openapi(deleteRecurringTransfer.route, deleteRecurringTransfer.handler);

export default router;
