import { env } from "@/env";
import { prisma } from "@pipeline/server/lib/prisma";
import { dateKey, dayInTz } from "@pipeline/server/lib/dates";
import {
  fetchMetaAccountInfo,
  fetchMetaDailyInsights,
} from "@pipeline/server/lib/meta-client";
import type { JobResult } from "@pipeline/server/lib/job-runner";

const RECENTLY_STOPPED_MS = 7 * 86_400_000;

// Ideas worth polling: live ones, plus recently-touched non-live ones so the
// final days of a killed/paused sprint still get the platforms' restatements.
export function pollableIdeaFilter() {
  return {
    OR: [
      { isLive: true },
      { updatedAt: { gte: new Date(Date.now() - RECENTLY_STOPPED_MS) } },
    ],
  };
}

// Window: today + trailing N days, re-pulled every run — both platforms
// restate history (attribution windows, invalid-click cleanup), so upserts
// overwrite rather than append.
export async function ingestMetaAds(windowDays = 7): Promise<JobResult> {
  if (!env.META_SYSTEM_USER_TOKEN) {
    return {
      recordsIn: 0,
      recordsOut: 0,
      metadata: { skipped: "META_SYSTEM_USER_TOKEN not configured" },
    };
  }

  const ideas = await prisma.idea.findMany({
    where: { metaAdAccountId: { not: null }, ...pollableIdeaFilter() },
    select: { id: true, slug: true, metaAdAccountId: true, timezone: true },
  });

  let recordsIn = 0;
  let recordsOut = 0;
  const errors: Record<string, string> = {};
  const window: Record<string, { since: string; until: string }> = {};

  for (const idea of ideas) {
    const accountId = idea.metaAdAccountId!;
    try {
      const info = await fetchMetaAccountInfo(accountId);
      // Mixing timezones/currencies silently shifts whole days of spend —
      // the classic off-by-one funnel bug. Fail loud instead.
      if (info.currency !== "BRL") {
        throw new Error(`account ${accountId} currency is ${info.currency}, expected BRL`);
      }
      if (info.timezoneName !== idea.timezone) {
        throw new Error(
          `account ${accountId} timezone is ${info.timezoneName}, expected ${idea.timezone}`,
        );
      }

      const since = dayInTz(idea.timezone, -windowDays);
      const until = dayInTz(idea.timezone, 0);
      window[idea.slug] = { since, until };

      const rows = await fetchMetaDailyInsights(accountId, since, until);
      recordsIn += rows.length;

      for (const row of rows) {
        const spendCents = Math.round(parseFloat(row.spend || "0") * 100);
        await prisma.adSpendDaily.upsert({
          where: {
            channel_accountId_campaignId_date: {
              channel: "META",
              accountId,
              campaignId: row.campaign_id,
              date: dateKey(row.date_start),
            },
          },
          create: {
            ideaId: idea.id,
            channel: "META",
            accountId,
            campaignId: row.campaign_id,
            campaignName: row.campaign_name,
            date: dateKey(row.date_start),
            spendCents,
            impressions: Number(row.impressions || 0),
            clicks: Number(row.clicks || 0),
            currency: "BRL",
            source: "API",
          },
          update: {
            ideaId: idea.id,
            campaignName: row.campaign_name,
            spendCents,
            impressions: Number(row.impressions || 0),
            clicks: Number(row.clicks || 0),
            source: "API",
          },
        });
        recordsOut++;
      }
    } catch (err) {
      errors[idea.slug] = err instanceof Error ? err.message : String(err);
    }
  }

  if (ideas.length > 0 && Object.keys(errors).length === ideas.length) {
    throw new Error(`all Meta accounts failed: ${JSON.stringify(errors)}`);
  }

  return {
    recordsIn,
    recordsOut,
    metadata: { window, accounts: ideas.length, errors },
  };
}
