import type { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";

import type { AppBindings } from "../types";

export default function configureOpenAPI(app: OpenAPIHono<AppBindings>) {
  app.doc("/doc", {
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "Pipeline API",
      description:
        "Funnel metrics dashboard for validation ideas — spend, sessions, leads, CAC and go/kill health",
    },
  });

  app.get(
    "/reference",
    apiReference({
      theme: "kepler",
      layout: "modern",
      metaData: {
        title: "Pipeline API Reference",
        description: "API documentation for the Pipeline dashboard",
      },
      defaultHttpClient: {
        targetKey: "js",
        clientKey: "fetch",
      },
      spec: {
        url: "/api/doc",
      },
    })
  );

  app.get("/", (c) => {
    return c.json({
      message: "Pipeline API",
      description:
        "Funnel metrics dashboard for validation ideas — spend, sessions, leads, CAC and go/kill health",
      version: "1.0.0",
      documentation: "/api/doc",
      reference: "/api/reference",
    });
  });
}
