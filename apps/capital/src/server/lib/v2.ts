import { z, type RouteConfig } from "@hono/zod-openapi";
import { jsonContent, jsonContentRequired } from "stoker/openapi/helpers";
import type { AppRouteHandler } from "../types";
import { requireUserId } from "./auth-middleware";
import { ApiErrorSchema, toHttpError } from "./http-error";

/** Shared response map for v2 routes; payloads are typed by the services and contracts. */
export const v2Responses = {
  200: jsonContent(z.any(), "OK"),
  400: jsonContent(ApiErrorSchema, "Bad request"),
  401: jsonContent(ApiErrorSchema, "Not authenticated"),
  404: jsonContent(ApiErrorSchema, "Not found"),
  409: jsonContent(ApiErrorSchema, "Conflict"),
  422: jsonContent(ApiErrorSchema, "Unprocessable"),
} as const;

export function jsonBody<T extends z.ZodTypeAny>(schema: T) {
  return { body: jsonContentRequired(schema, "Request body") };
}

export const idParams = z.object({ id: z.string().min(1) });

/** A "true"/"false" query flag. z.coerce.boolean() reads any non-empty string, "false" included, as true. */
export const queryFlag = z.enum(["true", "false"]).transform((v) => v === "true");

/** Maps domain errors to HTTP errors that keep their code and params for the envelope (see toHttpError). */
export const toHttp = toHttpError;

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
