import { createRouter } from "@capital/server/lib/create-app";

import * as getTransactions from "./get-transactions";
import * as postTransaction from "./post-transaction";
import * as putTransaction from "./put-transaction";
import * as deleteTransaction from "./delete-transaction";

const router = createRouter()
  .openapi(getTransactions.route, getTransactions.handler)
  .openapi(postTransaction.route, postTransaction.handler)
  .openapi(putTransaction.route, putTransaction.handler)
  .openapi(deleteTransaction.route, deleteTransaction.handler);

export default router;
