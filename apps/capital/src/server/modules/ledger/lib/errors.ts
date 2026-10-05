/** Domain error with an HTTP status; the v2 routes map it to a JSON error response. */
export class LedgerError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 403 | 404 | 409 | 422 = 400
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

export const notFound = (what: string) => new LedgerError(`${what} not found`, 404);
