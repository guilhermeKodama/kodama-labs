import { createRouter } from "@capital/server/lib/router";

/**
 * Personal API tokens for MCP clients (/v2/api-tokens). Mounted empty in
 * src/server/routes.ts so the settings slice only fills this file: list,
 * create (plaintext shown once), rotate and revoke.
 */
export const v2ApiTokens = createRouter();
