import { OpenAPIHono } from "@hono/zod-openapi";

import type { AppBindings } from "../types";
import { validationHook } from "./http-error";

export function createRouter() {
  return new OpenAPIHono<AppBindings>({
    strict: true,
    // Invalid body/query/params -> 422 { message, code: "validation", issues }.
    defaultHook: validationHook,
  });
}
