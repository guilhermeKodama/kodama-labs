import { OpenAPIHono } from "@hono/zod-openapi";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { notFound, onError, serveEmojiFavicon } from "stoker/middlewares";
import { defaultHook } from "stoker/openapi";

import { registerRoutes } from "../routes";
import configureOpenAPI from "./configure-open-api";
import { authMiddleware } from "./auth-middleware";

import type { AppBindings, AppOpenAPI } from "../types";

export function createRouter() {
  return new OpenAPIHono<AppBindings>({
    strict: true,
    defaultHook,
  });
}

export function createApp() {
  const app = createRouter().basePath("/api");

  // Middleware
  app.use("*", cors());
  app.use("*", logger());
  app.use(serveEmojiFavicon("💰"));

  // Auth middleware for all protected routes (exclude auth endpoints)
  app.use("/v1/businesses/*", authMiddleware);
  app.use("/v1/transactions/*", authMiddleware);
  app.use("/v1/transfers/*", authMiddleware);
  app.use("/v1/categories/*", authMiddleware);
  app.use("/v1/currencies/*", authMiddleware);
  app.use("/v1/budgets/*", authMiddleware);
  app.use("/v1/recurring/*", authMiddleware);
  app.use("/v1/recurring-transfers/*", authMiddleware);
  app.use("/v1/reports/*", authMiddleware);
  app.use("/v1/credit-cards/*", authMiddleware);
  app.use("/v1/investment-accounts/*", authMiddleware);
  app.use("/v1/investment-holdings/*", authMiddleware);
  app.use("/v1/investment-transactions/*", authMiddleware);
  app.use("/v1/investment-portfolio/*", authMiddleware);
  app.use("/v1/fire/*", authMiddleware);
  app.use("/v1/users/*", authMiddleware);
  app.use("/v1/bank-statements/*", authMiddleware);
  app.use("/v1/attachments/*", authMiddleware);
  app.use("/v1/assistant/*", authMiddleware);
  app.use("/v1/push/*", authMiddleware);

  // Error handling
  app.notFound(notFound);
  app.onError(onError);

  // OpenAPI documentation
  configureOpenAPI(app);

  // Register all routes and return the typed app
  return registerRoutes(app);
}

export function createTestApp<R extends AppOpenAPI>(router: R) {
  return createApp().route("/", router);
}
