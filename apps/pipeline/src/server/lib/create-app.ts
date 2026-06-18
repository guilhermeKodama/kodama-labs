import { OpenAPIHono } from "@hono/zod-openapi";
import { basicAuth } from "hono/basic-auth";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { notFound, onError, serveEmojiFavicon } from "stoker/middlewares";
import { defaultHook } from "stoker/openapi";

import { env } from "@/env";
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
  app.use(serveEmojiFavicon("📈"));

  // Single-user dashboard: /v1/* requires the same basic auth as the pages.
  // Public surfaces keep their own auth: /webhook/* (HMAC), /sync/* (bearer
  // SYNC_SECRET), /cron/* (bearer CRON_SECRET, plain route handlers outside Hono).
  if (env.DASHBOARD_USER && env.DASHBOARD_PASSWORD) {
    app.use(
      "/v1/*",
      basicAuth({
        username: env.DASHBOARD_USER,
        password: env.DASHBOARD_PASSWORD,
      }),
    );
  }

  app.notFound(notFound);
  app.onError(onError);

  configureOpenAPI(app);

  return registerRoutes(app);
}

export function createTestApp<R extends AppOpenAPI>(router: R) {
  return createApp().route("/", router);
}
