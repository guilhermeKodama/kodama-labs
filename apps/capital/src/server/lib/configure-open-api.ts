import type { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";

import type { AppBindings } from "../types";

export default function configureOpenAPI(app: OpenAPIHono<AppBindings>) {
  app.doc("/doc", {
    openapi: "3.0.0",
    info: {
      version: "1.0.0",
      title: "Capital API",
      description:
        "Financial management API for international service providers",
    },
  });

  app.get(
    "/reference",
    apiReference({
      theme: "kepler",
      layout: "modern",
      metaData: {
        title: "Capital API Reference",
        description: "API documentation for Capital financial management",
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
    const accept = c.req.header("accept");
    if (accept && accept.includes("text/html")) {
      return c.html(`
      <html>
        <head><title>Capital API</title></head>
        <body style="font-family: system-ui, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px;">
          <h1>💰 Capital API</h1>
          <p>Financial management API for international service providers</p>
          <ul>
            <li><a href="/api/doc">📄 OpenAPI Documentation (JSON)</a></li>
            <li><a href="/api/reference">📚 API Reference (Interactive)</a></li>
          </ul>
          <p><strong>Version:</strong> 1.0.0</p>
        </body>
      </html>
    `);
    }
    return c.json({
      message: "Welcome to Capital API",
      description:
        "Financial management API for international service providers",
      version: "1.0.0",
      documentation: "/api/doc",
      reference: "/api/reference",
    });
  });
}
