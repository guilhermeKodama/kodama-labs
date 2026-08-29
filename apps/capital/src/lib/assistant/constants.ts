// Client-safe mirror of apps/capital/src/server/modules/assistant/constants.ts
// (MAX_STATEMENT_FILE_BYTES) - kept separate since client components can't
// import server-only modules, and this is the one value the composer
// needs before ever hitting the network.

export const MAX_STATEMENT_FILE_BYTES = 15 * 1024 * 1024;

export const ALLOWED_STATEMENT_EXTENSIONS = ["ofx", "csv", "pdf"];
