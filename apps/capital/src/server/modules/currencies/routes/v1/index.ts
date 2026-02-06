import { createRouter } from "@capital/server/lib/create-app";

import * as getCurrencies from "./get-currencies";
import * as postCurrency from "./post-currency";
import * as putCurrency from "./put-currency";
import * as deleteCurrency from "./delete-currency";

const router = createRouter()
  .openapi(getCurrencies.route, getCurrencies.handler)
  .openapi(postCurrency.route, postCurrency.handler)
  .openapi(putCurrency.route, putCurrency.handler)
  .openapi(deleteCurrency.route, deleteCurrency.handler);

export default router;
