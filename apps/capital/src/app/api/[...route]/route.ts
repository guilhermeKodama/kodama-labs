import { handle } from "hono/vercel";
import app from "@capital/server/app";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// The assistant's agent loop can run several tool-calling iterations
// per turn (see modules/assistant/agent/loop.ts) - the platform default
// is too short for that, though most turns finish well under this.
export const maxDuration = 300;

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
export const OPTIONS = handle(app);
