import app from "@capital/server/app";

// Same adapter hono/vercel shipped: Next route handlers already speak Fetch.
const handle = (honoApp: { fetch: (req: Request) => Response | Promise<Response> }) =>
  (req: Request) => honoApp.fetch(req);

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
export const OPTIONS = handle(app);
