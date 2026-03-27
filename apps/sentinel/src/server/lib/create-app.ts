import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { notFound, onError, serveEmojiFavicon } from "stoker/middlewares";
import { defaultHook } from "stoker/openapi";

import { registerRoutes } from "../routes";
import configureOpenAPI from "./configure-open-api";

import type { AppBindings, AppOpenAPI } from "../types";

export function createRouter() {
  return new OpenAPIHono<AppBindings>({
    strict: true,
    defaultHook,
  });
}

export function createApp() {
  const app = createRouter().basePath("/api");

  app.use("*", cors());
  app.use("*", logger());
  app.use(serveEmojiFavicon("🔍"));

  app.notFound(notFound);
  app.onError(onError);

  configureOpenAPI(app);

  return registerRoutes(app);
}

export function createTestApp<R extends AppOpenAPI>(router: R) {
  return createApp().route("/", router);
}
