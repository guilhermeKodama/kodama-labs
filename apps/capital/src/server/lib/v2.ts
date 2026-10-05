import { z, type RouteConfig } from "@hono/zod-openapi";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";
import { jsonContent, jsonContentRequired } from "stoker/openapi/helpers";
import type { AppRouteHandler } from "../types";
import { requireUserId } from "./auth-middleware";
import { LedgerError } from "../modules/ledger/lib/errors";
import { HttpError, validationError } from "./http-error";

/** The error envelope (src/server/i18n/error-codes.ts: ApiErrorBody). */
const ErrorSchema = z.object({
  message: z.string(),
  code: z.string().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  issues: z.array(z.object({ path: z.string(), code: z.string(), message: z.string() })).optional(),
});

/** Shared response map for v2 routes; payloads are typed by the services and contracts. */
export const v2Responses = {
  200: jsonContent(z.any(), "OK"),
  400: jsonContent(ErrorSchema, "Bad request"),
  401: jsonContent(ErrorSchema, "Not authenticated"),
  404: jsonContent(ErrorSchema, "Not found"),
  409: jsonContent(ErrorSchema, "Conflict"),
  422: jsonContent(ErrorSchema, "Unprocessable"),
} as const;

export function jsonBody<T extends z.ZodTypeAny>(schema: T) {
  return { body: jsonContentRequired(schema, "Request body") };
}

export const idParams = z.object({ id: z.string().min(1) });

/** Maps domain errors to HTTP errors that keep their code and params for the envelope. */
export function toHttp(err: unknown): unknown {
  if (err instanceof HTTPException) return err;
  if (err instanceof LedgerError) return HttpError.fromLedgerError(err);
  if (err instanceof ZodError) return validationError(err);
  if (err instanceof Error && /not found|access denied/i.test(err.message)) return new HttpError(404, err.message, { code: "not_found" });
  return err;
}

type Ctx<R extends RouteConfig> = Parameters<AppRouteHandler<R>>[0];

/**
 * Authenticated JSON handler: resolves the user, runs `fn`, and maps domain
 * errors (LedgerError, ZodError) to HTTP errors for the app-level onError.
 */
export function v2Handler<R extends RouteConfig>(_route: R, fn: (c: Ctx<R>, userId: string) => Promise<unknown>): AppRouteHandler<R> {
  return (async (c: Ctx<R>) => {
    try {
      const userId = requireUserId(c as never);
      const data = await fn(c, userId);
      if (data instanceof Response) return data;
      return c.json((data ?? { ok: true }) as never, 200);
    } catch (err) {
      throw toHttp(err);
    }
  }) as unknown as AppRouteHandler<R>;
}
