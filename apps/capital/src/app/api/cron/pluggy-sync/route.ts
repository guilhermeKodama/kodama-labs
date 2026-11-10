import { NextRequest } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { withCron, type CronRunResult } from "@capital/server/lib/cron";
import { isPluggyConfigured } from "@capital/server/modules/pluggy/lib/config";
import { createPluggyClient, safeSyncError } from "@capital/server/modules/pluggy/lib/client";
import { anthropicIncomeGuesser } from "@capital/server/modules/pluggy/lib/guesser";
import { syncPluggy, type SyncReport } from "@capital/server/modules/pluggy/services/sync";

/**
 * Daily. Reads the Meu Pluggy snapshot for every saved item. With the
 * credentials unset this is a no-op: the rest of Capital is unchanged.
 * Meu Pluggy refreshes itself; this job does not ask the bank again. One
 * user's failure is recorded and does not stop the others.
 */
export async function GET(request: NextRequest) {
  return withCron(request, { job: "pluggy-sync" }, async (): Promise<CronRunResult> => {
    if (!isPluggyConfigured()) return { status: "skipped", body: { status: "disabled", message: "Pluggy is not configured" } };

    const users = await prisma.pluggyItem.findMany({ distinct: ["userId"], select: { userId: true } });
    if (!users.length) return { status: "skipped", body: { status: "idle", users: 0 } };

    const reports: SyncReport[] = [];
    const userErrors: string[] = [];
    for (const user of users) {
      try {
        reports.push(await syncPluggy(user.userId, { db: prisma, client: createPluggyClient(), now: new Date(), guesser: anthropicIncomeGuesser() }, { trigger: "cron" }));
      } catch (error) {
        const message = safeSyncError(error);
        console.error("[Pluggy] Cron failed for a user:", message);
        userErrors.push(message);
      }
    }
    const itemErrors = reports.flatMap((r) => r.items).filter((i) => i.status === "error").length;
    const rejected = userErrors.length + itemErrors;
    const status: CronRunResult["status"] = rejected === 0 ? "ok" : userErrors.length === users.length ? "failed" : "partial";
    return {
      status,
      requested: users.length,
      succeeded: users.length - userErrors.length,
      rejected,
      error: userErrors[0] ?? null,
      stats: { userErrors, itemErrors },
      body: { status: "ok", users: reports.length },
    };
  });
}
