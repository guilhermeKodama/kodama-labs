import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@capital/server/lib/prisma";
import { env } from "@/env";
import { updateAllPrices } from "@capital/server/modules/investments/services/update-prices";

// Allow up to 60 seconds for this function
export const maxDuration = 60;

/**
 * Cron endpoint that fetches current market prices for all ticker-based holdings.
 * Uses CoinGecko (crypto), brapi.dev (Brazilian B3), and Yahoo Finance (international).
 * Runs once daily at noon UTC.
 */
export async function GET(request: NextRequest) {
  // Verify the request is from Vercel Cron
  const authHeader = request.headers.get("authorization");
  const cronSecret = env.CRON_SECRET;

  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await updateAllPrices(prisma);

    return NextResponse.json({
      success: true,
      message: `Updated prices for ${result.updated}/${result.totalHoldings} holdings`,
      ...result,
      processedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("[PriceUpdate] Cron failed:", error);

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
