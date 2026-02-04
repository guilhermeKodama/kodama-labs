import { handle } from "hono/vercel";
import { createApp } from "@capital/server/lib/create-app";

const { app } = createApp();

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = handle(app);
export const POST = handle(app);
export const PUT = handle(app);
export const DELETE = handle(app);
export const PATCH = handle(app);
export const OPTIONS = handle(app);
