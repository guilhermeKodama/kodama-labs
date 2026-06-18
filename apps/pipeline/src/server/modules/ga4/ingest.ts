import { env } from "@/env";
import { prisma } from "@pipeline/server/lib/prisma";
import { dateKey, dayInTz } from "@pipeline/server/lib/dates";
import { fetchDailySessions } from "@pipeline/server/lib/ga4";
import type { JobResult } from "@pipeline/server/lib/job-runner";
import { mapChannel, type ChannelValue } from "@/lib/funnel/map-channel";
import { pollableIdeaFilter } from "../ad-spend/ingest-meta";

// Window D-4..D-1: GA4 reprocesses data for 24-48h, so each run re-pulls a
// few closed days and overwrites. "Today" is intentionally excluded — GA4
// intraday is unreliable; same-day kill signals come from the ads APIs.
const DEFAULT_WINDOW_DAYS = 4;

export async function ingestGa4(startOverride?: string): Promise<JobResult> {
  if (!env.GA4_SA_KEY_BASE64) {
    return {
      recordsIn: 0,
      recordsOut: 0,
      metadata: { skipped: "GA4_SA_KEY_BASE64 not configured" },
    };
  }

  const ideas = await prisma.idea.findMany({
    where: { ga4PropertyId: { not: null }, ...pollableIdeaFilter() },
    select: { id: true, slug: true, ga4PropertyId: true, timezone: true },
  });

  let recordsIn = 0;
  let recordsOut = 0;
  const errors: Record<string, string> = {};

  for (const idea of ideas) {
    try {
      const since = startOverride ?? dayInTz(idea.timezone, -DEFAULT_WINDOW_DAYS);
      const until = dayInTz(idea.timezone, -1);
      if (since > until) continue;

      const rows = await fetchDailySessions(idea.ga4PropertyId!, since, until);
      recordsIn += rows.length;

      // Aggregate source/medium rows into channels per day.
      const grid = new Map<
        string,
        { sessions: number; engagedSessions: number; totalUsers: number }
      >();
      for (const row of rows) {
        const channel = mapChannel({ source: row.source, medium: row.medium });
        const key = `${row.date}|${channel}`;
        const cell = grid.get(key) ?? { sessions: 0, engagedSessions: 0, totalUsers: 0 };
        cell.sessions += row.sessions;
        cell.engagedSessions += row.engagedSessions;
        cell.totalUsers += row.totalUsers;
        grid.set(key, cell);
      }

      // Zero-fill: a (date, channel) row we stored before can vanish from a
      // re-pull after GA4 reprocessing — zero it instead of leaving stale data.
      const existing = await prisma.ga4SessionsDaily.findMany({
        where: {
          ideaId: idea.id,
          date: { gte: dateKey(since), lte: dateKey(until) },
        },
        select: { date: true, channel: true },
      });
      for (const row of existing) {
        const day = row.date.toISOString().slice(0, 10);
        const key = `${day}|${row.channel}`;
        if (!grid.has(key)) {
          grid.set(key, { sessions: 0, engagedSessions: 0, totalUsers: 0 });
        }
      }
      for (const [key, cell] of grid) {
        const [day, channel] = key.split("|") as [string, ChannelValue];
        await prisma.ga4SessionsDaily.upsert({
          where: {
            ideaId_channel_date: {
              ideaId: idea.id,
              channel,
              date: dateKey(day),
            },
          },
          create: {
            ideaId: idea.id,
            channel,
            date: dateKey(day),
            sessions: cell.sessions,
            engagedSessions: cell.engagedSessions,
            totalUsers: cell.totalUsers,
          },
          update: {
            sessions: cell.sessions,
            engagedSessions: cell.engagedSessions,
            totalUsers: cell.totalUsers,
          },
        });
        recordsOut++;
      }
    } catch (err) {
      errors[idea.slug] = err instanceof Error ? err.message : String(err);
    }
  }

  if (ideas.length > 0 && Object.keys(errors).length === ideas.length) {
    throw new Error(`all GA4 properties failed: ${JSON.stringify(errors)}`);
  }

  return {
    recordsIn,
    recordsOut,
    metadata: { properties: ideas.length, errors },
  };
}
