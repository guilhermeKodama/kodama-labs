import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { updateAllCurrencyRates } from "@capital/server/modules/currencies/services/update-rates-from-api";

// Allow up to 30 seconds for this function
export const maxDuration = 30;

/**
 * Cron endpoint that fetches latest exchange rates from Frankfurter API
 * and updates all users' currency rates.
 * Runs hourly.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await updateAllCurrencyRates(prisma);

    return NextResponse.json({
      success: true,
      message: `Updated ${result.ratesUpdated} rates for ${result.usersProcessed} users`,
      ...result,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[RateUpdate] Cron failed:", error);

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
        processedAt: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
