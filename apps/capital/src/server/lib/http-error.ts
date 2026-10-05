import { z, type Hook } from "@hono/zod-openapi";
import type { ErrorHandler, NotFoundHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { ZodError } from "zod";
import { Prisma } from "@/generated/prisma";
import type { ApiErrorBody, ErrorCode, ErrorParams, ValidationIssue } from "../i18n/error-codes";
import { LedgerError } from "../modules/ledger/lib/errors";
import type { AppBindings } from "../types";

/** OpenAPI schema of the error envelope (ApiErrorBody), for every route's error responses. */
export const ApiErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
});

/**
 * An HTTP error that carries the envelope fields (src/server/i18n/error-codes.ts):
 * a stable code, its params and, for validation errors, the failed checks.
 */
export class HttpError extends HTTPException {
  readonly code: ErrorCode;
  readonly params?: ErrorParams;
  readonly issues?: ValidationIssue[];

  constructor(status: ContentfulStatusCode, message: string, details: { code: ErrorCode; params?: ErrorParams; issues?: ValidationIssue[] }) {
    super(status, { message });
    this.code = details.code;
    if (details.params) this.params = details.params;
    if (details.issues) this.issues = details.issues;
  }

  static fromLedgerError(err: LedgerError) {
    return new HttpError(err.status, err.message, { code: err.code, params: err.params });
  }
}

export function zodIssues(error: ZodError): ValidationIssue[] {
  return error.issues.map((i) => ({ path: i.path.join("."), code: i.code, message: i.message }));
}

/** 422 with code "validation"; the message lists the issues for clients that only read `message`. */
export function validationError(error: ZodError) {
  const issues = zodIssues(error);
  const message = issues.map((i) => (i.path ? `${i.path}: ${i.message}` : i.message)).join("; ") || "Invalid request";
  return new HttpError(422, message, { code: "validation", issues });
}

/**
 * Maps a thrown value to an HTTP error that keeps its code and params for
 * the envelope: a LedgerError keeps its status, a ZodError is a 422
 * validation error, Prisma's record-not-found and unique-violation errors are
 * 404 not_found and 409 duplicate (without Prisma's message, which names
 * source files), and a plain error whose message says "not found" or
 * "access denied" is a 404. Anything else comes back as it is (a 500 without
 * a code).
 */
export function toHttpError(err: unknown): unknown {
  if (err instanceof HTTPException) return err;
  if (err instanceof LedgerError) return HttpError.fromLedgerError(err);
  if (err instanceof ZodError) return validationError(err);
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2025") return new HttpError(404, "Record not found", { code: "not_found" });
    if (err.code === "P2002") return new HttpError(409, "A record with the same values already exists", { code: "duplicate" });
  }
  if (err instanceof Error && /not found|access denied/i.test(err.message)) return new HttpError(404, err.message, { code: "not_found" });
  return err;
}

function envelope(err: HttpError): ApiErrorBody {
  return {
    message: err.message,
    code: err.code,
    ...(err.params && { params: err.params }),
    ...(err.issues && { issues: err.issues }),
  };
}

/** Request validation for every router: a 422 envelope instead of the raw ZodError. */
export const validationHook: Hook<unknown, AppBindings, string, Response | undefined> = (result, c) => {
  if (!result.success) return c.json(envelope(validationError(result.error)), 422);
  return undefined;
};

/**
 * App-level error handler: every error becomes { message, code?, params?, issues? }.
 * Errors that escaped a handler (v1 routes throw instead of answering) are
 * mapped like v2Handler maps them (toHttpError); the rest keep their status
 * (500 when they have none) and, outside production, a 5xx shows its stack.
 */
export const onError: ErrorHandler<AppBindings> = (err, c) => {
  const error = toHttpError(err) as Error;
  const raw = "status" in error && typeof error.status === "number" ? error.status : 500;
  const status = (raw >= 400 && raw <= 599 ? raw : 500) as ContentfulStatusCode;
  const body: ApiErrorBody & { stack?: string } = error instanceof HttpError ? envelope(error) : { message: error.message };
  if (status >= 500 && process.env.NODE_ENV !== "production") body.stack = error.stack;
  return c.json(body, status);
};

/** Unknown route: the envelope with code not_found. */
export const notFoundHandler: NotFoundHandler<AppBindings> = (c) => c.json({ message: `Not Found - ${c.req.path}`, code: "not_found" } satisfies ApiErrorBody, 404);
