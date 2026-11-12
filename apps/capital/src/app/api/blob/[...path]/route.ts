import { runtimeAppUrl } from "@repo/storage";
import { createLocalBlobHandler } from "@repo/storage/next";
import { env } from "@/env";
import { prisma } from "@capital/server/lib/prisma";
import { SESSION_COOKIE_NAME } from "@capital/server/modules/auth/constants";
import { validateSession } from "@capital/server/modules/auth/services/session";
import { canReadBlob } from "@capital/server/modules/attachments/services/blob-access";

const serve = createLocalBlobHandler({
  localDir: env.CAPITAL_BLOB_DIR,
  appUrl: runtimeAppUrl(env.NEXT_PUBLIC_APP_URL),
});

type RouteContext = { params: Promise<{ path: string[] }> };

const json = (status: number, body: { message: string; code: string }) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** Stored files (attachments, assistant uploads): only to their owner's session; anyone else gets the same 404 as a missing file. */
export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const sessionId = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${SESSION_COOKIE_NAME}=`))
    ?.slice(SESSION_COOKIE_NAME.length + 1);
  const session = sessionId ? await validateSession(sessionId, prisma) : null;
  if (!session) return json(401, { message: "Authentication required", code: "auth.required" });
  const { path } = await context.params;
  const pathname = path.map(decodeURIComponent).join("/");
  if (!(await canReadBlob(session.userId, pathname, prisma))) return json(404, { message: "Blob not found", code: "not_found" });
  return serve(request, context);
}
