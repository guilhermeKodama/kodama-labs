import { createRouter } from "@capital/server/lib/create-app";

import * as getTransfers from "./get-transfers";
import * as postTransfer from "./post-transfer";
import * as putTransfer from "./put-transfer";
import * as deleteTransfer from "./delete-transfer";

const router = createRouter()
  .openapi(getTransfers.route, getTransfers.handler)
  .openapi(postTransfer.route, postTransfer.handler)
  .openapi(putTransfer.route, putTransfer.handler)
  .openapi(deleteTransfer.route, deleteTransfer.handler);

export default router;
