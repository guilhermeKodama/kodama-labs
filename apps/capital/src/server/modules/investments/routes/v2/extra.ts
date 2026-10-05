import { createRouter } from "@capital/server/lib/router";

/**
 * The new investment endpoints: POST /v2/investments/aporte, POST
 * /v2/investments/orders, GET /v2/quotes, GET /v2/assets/search and GET
 * /v2/portfolio/history. Mounted empty in src/server/routes.ts so the
 * investments slice only fills this file.
 */
export const v2InvestmentsExtra = createRouter();
