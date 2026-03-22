import type { OpenAPIHono, RouteConfig, RouteHandler } from "@hono/zod-openapi";
import type { PrismaClient } from "@/generated/prisma";

// App bindings for Hono context
export interface AppBindings {
  Variables: {
    db: PrismaClient;
    userId?: string;
  };
}

// Type for OpenAPI-enabled Hono app
export type AppOpenAPI = OpenAPIHono<AppBindings>;

// Type for route handlers
export type AppRouteHandler<R extends RouteConfig> = RouteHandler<
  R,
  AppBindings
>;
