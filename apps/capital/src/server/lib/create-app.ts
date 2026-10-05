import { createRouter } from "./router";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { notFound, onError, serveEmojiFavicon } from "stoker/middlewares";

import { registerRoutes } from "../routes";
import configureOpenAPI from "./configure-open-api";
import { authMiddleware } from "./auth-middleware";

import type { AppOpenAPI } from "../types";

export { createRouter };

export function createApp() {
  const app = createRouter().basePath("/api");

  // Middleware
  app.use("*", cors());
  app.use("*", logger());
  app.use(serveEmojiFavicon("💰"));

  // Auth middleware for all protected routes (exclude auth endpoints)
  app.use("/v1/fire/*", authMiddleware);
  app.use("/v1/assistant/*", authMiddleware);
  app.use("/v1/push/*", authMiddleware);
  app.use("/v2/*", async (c, next) => (c.req.path.startsWith("/api/v2/auth/") ? next() : authMiddleware(c, next)));

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
