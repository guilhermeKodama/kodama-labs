import type { ErrorCode, ErrorDetails, ErrorParams, ParamlessErrorCode } from "@capital/server/i18n/error-codes";

export type LedgerErrorStatus = 400 | 403 | 404 | 409 | 422;

/**
 * Domain error with an HTTP status and a stable code (src/server/i18n/error-codes.ts);
 * the v2 routes map it to a JSON error response. The English message is what
 * the MCP server and the assistant show; the UI translates `code` + `params`.
 */
export class LedgerError extends Error {
  readonly code: ErrorCode;
  readonly params?: ErrorParams;

  constructor(
    message: string,
    readonly status: LedgerErrorStatus,
    details: ErrorDetails
  ) {
    super(message);
    this.name = "LedgerError";
    this.code = details.code;
    if (details.params) this.params = details.params;
  }
}

/** "<what> not found" (404) with a code that takes no params. */
export const notFound = (what: string, code: ParamlessErrorCode) => new LedgerError(`${what} not found`, 404, { code } as ErrorDetails);
