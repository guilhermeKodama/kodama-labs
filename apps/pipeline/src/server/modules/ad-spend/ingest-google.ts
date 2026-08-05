import { env } from "@/env";
import { prisma } from "@pipeline/server/lib/prisma";
import { dateKey, dayInTz, ingestSince } from "@pipeline/server/lib/dates";
import type { JobResult } from "@pipeline/server/lib/job-runner";
import { pollableIdeaFilter } from "./ingest-meta";

interface GoogleRow {
  date: string;
  campaignId: string;
  campaignName: string;
  costMicros: number;
  impressions: number;
  clicks: number;
}

function googleConfigured(): boolean {
  return Boolean(
    env.GOOGLE_ADS_DEVELOPER_TOKEN &&
      env.GOOGLE_ADS_CLIENT_ID &&
      env.GOOGLE_ADS_CLIENT_SECRET &&
      env.GOOGLE_ADS_REFRESH_TOKEN &&
      env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
  );
}

// One idea owns a dedicated Google account → every campaign is that idea's, no
// naming convention needed. Only when several ideas SHARE one account do we
// disambiguate by campaign-name prefix (longest match wins); no match there →
// ideaId null, still ingested and surfaced as "unassigned" in the UI.
function resolveIdea(
  campaignName: string,
  ideas: Array<{ id: string; googleCampaignPrefix: string | null; slug: string }>,
): string | null {
  if (ideas.length === 1) return ideas[0]!.id;
  const name = campaignName.toLowerCase();
  let best: { id: string; length: number } | null = null;
  for (const idea of ideas) {
    const prefix = (idea.googleCampaignPrefix ?? idea.slug).toLowerCase();
    if (name.startsWith(prefix) && (!best || prefix.length > best.length)) {
      best = { id: idea.id, length: prefix.length };
    }
  }
  return best?.id ?? null;
}

// Window: backfill from launch on first sight, then incremental with a 7-day
// trailing overlap. forceDays (from ?days=N) forces a fixed window.
export async function ingestGoogleAds(forceDays?: number): Promise<JobResult> {
  if (!googleConfigured()) {
    return {
      recordsIn: 0,
      recordsOut: 0,
      metadata: { skipped: "Google Ads credentials not configured" },
    };
  }

  const ideas = await prisma.idea.findMany({
    where: { googleCustomerId: { not: null }, ...pollableIdeaFilter() },
    select: {
      id: true,
      slug: true,
      googleCustomerId: true,
      googleCampaignPrefix: true,
      timezone: true,
      adsLaunchedAt: true,
    },
  });
  if (ideas.length === 0) {
    return { recordsIn: 0, recordsOut: 0, metadata: { skipped: "no ideas with google_customer_id" } };
  }

  // Lazy import: the lib (and its gRPC/proto weight) only loads when creds exist.
  const { GoogleAdsApi } = await import("google-ads-api");
  const client = new GoogleAdsApi({
    client_id: env.GOOGLE_ADS_CLIENT_ID!,
    client_secret: env.GOOGLE_ADS_CLIENT_SECRET!,
    developer_token: env.GOOGLE_ADS_DEVELOPER_TOKEN!,
  });

  const customerIds = [...new Set(ideas.map((i) => i.googleCustomerId!))];
  let recordsIn = 0;
  let recordsOut = 0;
  let unmapped = 0;
  const errors: Record<string, string> = {};

  for (const customerId of customerIds) {
    const customerIdeas = ideas.filter((i) => i.googleCustomerId === customerId);
    const timezone = customerIdeas[0]!.timezone;
    try {
      const customer = client.Customer({
        customer_id: customerId,
        login_customer_id: env.GOOGLE_ADS_LOGIN_CUSTOMER_ID!,
        refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN!,
      });

      const meta = (await customer.query(
        `SELECT customer.time_zone, customer.currency_code FROM customer`,
      )) as Array<{ customer: { time_zone: string; currency_code: string } }>;
      const tz = meta[0]?.customer.time_zone;
      const currency = meta[0]?.customer.currency_code;
      if (currency !== "BRL") {
        throw new Error(`customer ${customerId} currency is ${currency}, expected BRL`);
      }
      if (tz !== timezone) {
        throw new Error(`customer ${customerId} timezone is ${tz}, expected ${timezone}`);
      }

      // First sight of this account → backfill from launch; then overlap only.
      const latest =
        forceDays != null
          ? null
          : (
              await prisma.adSpendDaily.aggregate({
                where: { accountId: customerId, channel: "GOOGLE" },
                _max: { date: true },
              })
            )._max.date;
      const since = ingestSince(latest, {
        adsLaunchedAt: customerIdeas[0]!.adsLaunchedAt,
        timezone,
        overlapDays: 7,
        backfillLookbackDays: 90,
        forceDays,
      });
      const until = dayInTz(timezone, 0);
      if (since > until) continue;

      const raw = (await customer.query(`
        SELECT segments.date, campaign.id, campaign.name,
               metrics.cost_micros, metrics.impressions, metrics.clicks
        FROM campaign
        WHERE segments.date BETWEEN '${since}' AND '${until}'
        ORDER BY segments.date
      `)) as Array<{
        segments: { date: string };
        campaign: { id: number | string; name: string };
        metrics: { cost_micros: number; impressions: number; clicks: number };
      }>;

      const rows: GoogleRow[] = raw.map((r) => ({
        date: r.segments.date,
        campaignId: String(r.campaign.id),
        campaignName: r.campaign.name,
        costMicros: Number(r.metrics.cost_micros ?? 0),
        impressions: Number(r.metrics.impressions ?? 0),
        clicks: Number(r.metrics.clicks ?? 0),
      }));
      recordsIn += rows.length;

      for (const row of rows) {
        const ideaId = resolveIdea(row.campaignName, customerIdeas);
        if (!ideaId) unmapped++;
        await prisma.adSpendDaily.upsert({
          where: {
            channel_accountId_campaignId_date: {
              channel: "GOOGLE",
              accountId: customerId,
              campaignId: row.campaignId,
              date: dateKey(row.date),
            },
          },
          create: {
            ideaId,
            channel: "GOOGLE",
            accountId: customerId,
            campaignId: row.campaignId,
            campaignName: row.campaignName,
            date: dateKey(row.date),
            spendCents: Math.round(row.costMicros / 10_000),
            impressions: row.impressions,
            clicks: row.clicks,
            currency: "BRL",
            source: "API",
          },
          update: {
            ideaId, // re-resolved every run: prefix fixes apply retroactively
            campaignName: row.campaignName,
            spendCents: Math.round(row.costMicros / 10_000),
            impressions: row.impressions,
            clicks: row.clicks,
            source: "API",
          },
        });
        recordsOut++;
      }
    } catch (err) {
      errors[customerId] = err instanceof Error ? err.message : String(err);
    }
  }

  if (Object.keys(errors).length === customerIds.length) {
    throw new Error(`all Google customers failed: ${JSON.stringify(errors)}`);
  }

  return {
    recordsIn,
    recordsOut,
    metadata: { customers: customerIds.length, unmappedCampaignRows: unmapped, errors },
  };
}
