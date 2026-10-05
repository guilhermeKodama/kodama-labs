import { createRouter } from "@capital/server/lib/router";

/**
 * Ledger flow endpoints (/v2/ledger/flows/...), built on the flowKind of
 * ../../lib/flow-sql.ts. Mounted empty in src/server/routes.ts so the slice
 * that adds them only fills this file.
 */
export const ledgerFlowRoutes = createRouter();
