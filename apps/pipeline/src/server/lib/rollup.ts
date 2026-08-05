import { Prisma } from "@/generated/prisma";
import { prisma } from "./prisma";
import { dateKey } from "./dates";
import {
  addCounts,
  EMPTY_COUNTS,
  type RawCounts,
} from "@/lib/funnel/types";
import type { ChannelValue } from "@/lib/funnel/map-channel";

// Period accounting: every event counts on the day it happened (lead on
// createdAt, activation on activatedAt, conversion on convertedAt), bucketed
// in the idea's timezone so funnel days line up with the ads platforms' days.
// Derived metrics are computed AFTER summation by the health engine.

export type PaidChannel = "META" | "GOOGLE";

export interface RollupRange {
  from: string; // YYYY-MM-DD inclusive, idea timezone
  to: string;
  channel?: PaidChannel; // undefined = all channels
}

const ALL_CHANNELS: ChannelValue[] = ["META", "GOOGLE", "ORGANIC", "DIRECT", "OTHER"];

export async function rollupByChannel(
  ideaId: string,
  timezone: string,
  range: Omit<RollupRange, "channel">,
): Promise<Record<ChannelValue, RawCounts>> {
  const from = dateKey(range.from);
  const to = dateKey(range.to);

  const [spend, ga4, leads] = await Promise.all([
    prisma.adSpendDaily.groupBy({
      by: ["channel"],
      where: { ideaId, date: { gte: from, lte: to } },
      _sum: { spendCents: true, impressions: true, clicks: true },
    }),
    prisma.ga4SessionsDaily.groupBy({
      by: ["channel"],
      where: { ideaId, date: { gte: from, lte: to } },
      _sum: { sessions: true, engagedSessions: true },
    }),
    prisma.$queryRaw<
      Array<{ channel: string; leads: bigint; activated: bigint; customers: bigint }>
    >(Prisma.sql`
      SELECT channel,
        COUNT(*) FILTER (WHERE ("createdAt" AT TIME ZONE ${timezone})::date
          BETWEEN ${range.from}::date AND ${range.to}::date) AS leads,
        COUNT(*) FILTER (WHERE "activatedAt" IS NOT NULL
          AND ("activatedAt" AT TIME ZONE ${timezone})::date
          BETWEEN ${range.from}::date AND ${range.to}::date) AS activated,
        COUNT(*) FILTER (WHERE "convertedAt" IS NOT NULL
          AND ("convertedAt" AT TIME ZONE ${timezone})::date
          BETWEEN ${range.from}::date AND ${range.to}::date) AS customers
      FROM leads
      WHERE "ideaId" = ${ideaId}
      GROUP BY channel
    `),
  ]);

  const result = Object.fromEntries(
    ALL_CHANNELS.map((c) => [c, { ...EMPTY_COUNTS }]),
  ) as Record<ChannelValue, RawCounts>;

  for (const row of spend) {
    const c = result[row.channel as ChannelValue];
    c.spendCents += row._sum.spendCents ?? 0;
    c.impressions += row._sum.impressions ?? 0;
    c.clicks += row._sum.clicks ?? 0;
  }
  for (const row of ga4) {
    const c = result[row.channel as ChannelValue];
    c.sessions += row._sum.sessions ?? 0;
    c.engagedSessions += row._sum.engagedSessions ?? 0;
  }
  for (const row of leads) {
    const c = result[row.channel as ChannelValue];
    if (!c) continue;
    c.leads += Number(row.leads);
    c.activated += Number(row.activated);
    c.customers += Number(row.customers);
  }

  return result;
}

export function sumChannels(
  byChannel: Record<ChannelValue, RawCounts>,
  channel?: PaidChannel,
): RawCounts {
  if (channel) return byChannel[channel];
  return ALL_CHANNELS.reduce(
    (acc, c) => addCounts(acc, byChannel[c]),
    { ...EMPTY_COUNTS },
  );
}

export interface DailyPoint {
  date: string;
  spendCents: number;
  impressions: number;
  clicks: number;
  sessions: number;
  engagedSessions: number;
  leads: number;
  activated: number;
  customers: number;
}

export async function rollupDaily(
  ideaId: string,
  timezone: string,
  range: RollupRange,
): Promise<DailyPoint[]> {
  const from = dateKey(range.from);
  const to = dateKey(range.to);
  const channelFilter = range.channel ? { channel: range.channel } : {};
  const leadChannelSql = range.channel
    ? Prisma.sql`AND channel = ${range.channel}::"Channel"`
    : Prisma.empty;

  const [spend, ga4, leadDays] = await Promise.all([
    prisma.adSpendDaily.groupBy({
      by: ["date"],
      where: { ideaId, date: { gte: from, lte: to }, ...channelFilter },
      _sum: { spendCents: true, impressions: true, clicks: true },
    }),
    prisma.ga4SessionsDaily.groupBy({
      by: ["date"],
      where: { ideaId, date: { gte: from, lte: to }, ...channelFilter },
      _sum: { sessions: true, engagedSessions: true },
    }),
    prisma.$queryRaw<
      Array<{ day: Date; leads: bigint; activated: bigint; customers: bigint }>
    >(Prisma.sql`
      WITH days AS (
        SELECT
          ("createdAt" AT TIME ZONE ${timezone})::date AS created_day,
          ("activatedAt" AT TIME ZONE ${timezone})::date AS activated_day,
          ("convertedAt" AT TIME ZONE ${timezone})::date AS converted_day
        FROM leads
        WHERE "ideaId" = ${ideaId} ${leadChannelSql}
      ),
      all_days AS (
        SELECT created_day AS day FROM days WHERE created_day IS NOT NULL
        UNION
        SELECT activated_day FROM days WHERE activated_day IS NOT NULL
        UNION
        SELECT converted_day FROM days WHERE converted_day IS NOT NULL
      )
      SELECT d.day,
        (SELECT COUNT(*) FROM days WHERE created_day = d.day) AS leads,
        (SELECT COUNT(*) FROM days WHERE activated_day = d.day) AS activated,
        (SELECT COUNT(*) FROM days WHERE converted_day = d.day) AS customers
      FROM all_days d
      WHERE d.day BETWEEN ${range.from}::date AND ${range.to}::date
    `),
  ]);

  const points = new Map<string, DailyPoint>();
  const point = (date: string): DailyPoint => {
    let p = points.get(date);
    if (!p) {
      p = {
        date,
        spendCents: 0,
        impressions: 0,
        clicks: 0,
        sessions: 0,
        engagedSessions: 0,
        leads: 0,
        activated: 0,
        customers: 0,
      };
      points.set(date, p);
    }
    return p;
  };

  for (const row of spend) {
    const p = point(row.date.toISOString().slice(0, 10));
    p.spendCents += row._sum.spendCents ?? 0;
    p.impressions += row._sum.impressions ?? 0;
    p.clicks += row._sum.clicks ?? 0;
  }
  for (const row of ga4) {
    const p = point(row.date.toISOString().slice(0, 10));
    p.sessions += row._sum.sessions ?? 0;
    p.engagedSessions += row._sum.engagedSessions ?? 0;
  }
  for (const row of leadDays) {
    const p = point(row.day.toISOString().slice(0, 10));
    p.leads += Number(row.leads);
    p.activated += Number(row.activated);
    p.customers += Number(row.customers);
  }

  return [...points.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// Data-quality / freshness flags surfaced on the dashboard instead of hidden.
export interface IdeaDataQuality {
  manualApiOverlapDays: number;
  unassignedSpendCents: number; // GOOGLE rows whose campaign prefix matched no idea
  adsSyncedAt: Date | null;
  ga4SyncedAt: Date | null;
}

export async function ideaDataQuality(ideaId: string): Promise<IdeaDataQuality> {
  const [overlap, lastAds, lastGa4] = await Promise.all([
    prisma.$queryRaw<Array<{ days: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT (channel, date)) AS days FROM ad_spend_daily
      WHERE "ideaId" = ${ideaId}
        AND (channel, date) IN (
          SELECT channel, date FROM ad_spend_daily
          WHERE "ideaId" = ${ideaId}
          GROUP BY channel, date
          HAVING COUNT(DISTINCT source) > 1
        )
    `),
    prisma.adSpendDaily.aggregate({
      where: { ideaId, source: "API" },
      _max: { pulledAt: true },
    }),
    prisma.ga4SessionsDaily.aggregate({
      where: { ideaId },
      _max: { ga4SyncedAt: true },
    }),
  ]);

  return {
    manualApiOverlapDays: Number(overlap[0]?.days ?? 0),
    unassignedSpendCents: 0, // global, computed separately (unassigned rows have ideaId null)
    adsSyncedAt: lastAds._max.pulledAt,
    ga4SyncedAt: lastGa4._max.ga4SyncedAt,
  };
}

export async function unassignedSpend(): Promise<{
  totalCents: number;
  campaigns: Array<{ channel: string; campaignName: string; spendCents: number }>;
}> {
  const rows = await prisma.adSpendDaily.groupBy({
    by: ["channel", "campaignName"],
    where: { ideaId: null },
    _sum: { spendCents: true },
  });
  return {
    totalCents: rows.reduce((acc, r) => acc + (r._sum.spendCents ?? 0), 0),
    campaigns: rows.map((r) => ({
      channel: r.channel,
      campaignName: r.campaignName,
      spendCents: r._sum.spendCents ?? 0,
    })),
  };
}
