import { prisma } from "./prisma";
import { dayInTz } from "./dates";
import {
  ideaDataQuality,
  rollupByChannel,
  rollupDaily,
  sumChannels,
  type DailyPoint,
  type PaidChannel,
} from "./rollup";
import { evaluateFunnel, FORMULAS } from "@/lib/funnel/health";
import { deriveCacBands, resolveVerdict } from "@/lib/funnel/bands";
import { DEFAULT_GOOGLE_CTR, DEFAULT_THRESHOLDS } from "@/lib/funnel/defaults";
import type {
  CacBand,
  MetricHealth,
  MetricKeyT,
  RawCounts,
  ThresholdMap,
  Verdict,
} from "@/lib/funnel/types";
import type { ChannelValue } from "@/lib/funnel/map-channel";
import type { Idea } from "@/generated/prisma";

// Resolution order per metric: (metric, channel) row → (metric, ALL) row →
// code default. Channel-specific rows only exist for paid channels.
export async function resolveThresholds(
  ideaId: string,
  channel?: PaidChannel,
): Promise<ThresholdMap> {
  const rows = await prisma.metricThreshold.findMany({ where: { ideaId } });
  const map: ThresholdMap = { ...DEFAULT_THRESHOLDS };
  if (channel === "GOOGLE") map.CTR = DEFAULT_GOOGLE_CTR;

  for (const row of rows) {
    if (row.channel !== "ALL") continue;
    map[row.metric as MetricKeyT] = {
      healthy: Number(row.healthyValue),
      death: Number(row.deathValue),
    };
  }
  if (channel) {
    for (const row of rows) {
      if (row.channel === channel) {
        map[row.metric as MetricKeyT] = {
          healthy: Number(row.healthyValue),
          death: Number(row.deathValue),
        };
      }
    }
  }
  return map;
}

export function ideaCacBands(idea: Idea): CacBand[] {
  if (Array.isArray(idea.cacBands)) {
    return idea.cacBands as unknown as CacBand[];
  }
  if (idea.projectedLtvCents) {
    return deriveCacBands(idea.projectedLtvCents, idea.maxCacCents);
  }
  return [];
}

export interface IdeaFunnel {
  idea: Idea;
  range: { from: string; to: string };
  channel: PaidChannel | undefined;
  counts: RawCounts;
  byChannel: Record<ChannelValue, RawCounts>;
  health: MetricHealth[];
  verdict: Verdict;
  channelKillBreached: Partial<Record<PaidChannel, boolean>>;
  daily: DailyPoint[];
  dayN: number | null; // days since adsLaunchedAt (1-based), for budget pacing
  quality: Awaited<ReturnType<typeof ideaDataQuality>> & {
    sessionsToClicksRatio: number | null; // trailing window; < 0.7 = GA4 undercount badge
    staleAdsHours: number | null;
    staleGa4Hours: number | null;
  };
}

export function defaultRange(idea: Idea): { from: string; to: string } {
  const to = dayInTz(idea.timezone, 0);
  const from = idea.adsLaunchedAt
    ? dayInTz(idea.timezone, 0, idea.adsLaunchedAt)
    : dayInTz(idea.timezone, -28);
  return { from, to };
}

export async function getIdeaFunnel(
  slug: string,
  params: { from?: string; to?: string; channel?: PaidChannel },
): Promise<IdeaFunnel | null> {
  const idea = await prisma.idea.findUnique({ where: { slug } });
  if (!idea) return null;

  const fallback = defaultRange(idea);
  const range = {
    from: params.from ?? fallback.from,
    to: params.to ?? fallback.to,
  };

  const [byChannel, thresholds, daily, quality] = await Promise.all([
    rollupByChannel(idea.id, idea.timezone, range),
    resolveThresholds(idea.id, params.channel),
    rollupDaily(idea.id, idea.timezone, { ...range, channel: params.channel }),
    ideaDataQuality(idea.id),
  ]);

  const counts = sumChannels(byChannel, params.channel);

  const health = evaluateFunnel(counts, thresholds, {
    adsLaunchedAt: idea.adsLaunchedAt,
    now: new Date(),
    killCacCents: lastBandEdge(ideaCacBands(idea)) ?? idea.maxCacCents,
  });

  const bands = ideaCacBands(idea);
  const cac = FORMULAS.CAC(counts);
  const ar = FORMULAS.AR(counts);
  const verdict = bands.length
    ? resolveVerdict(cac, ar, bands)
    : ({ decision: "COLLECTING", status: "insufficient_data" } as Verdict);

  // Per-channel hard kill line (milhasgrupo: kill the CHANNEL at R$500 while
  // the blended kill is R$400).
  const channelKillBreached: Partial<Record<PaidChannel, boolean>> = {};
  if (idea.channelKillCacCents) {
    for (const ch of ["META", "GOOGLE"] as const) {
      const chCac = FORMULAS.CAC(byChannel[ch]);
      if (chCac != null && chCac > idea.channelKillCacCents) {
        channelKillBreached[ch] = true;
      }
    }
  }

  const paid = sumChannels(byChannel, undefined);
  const sessionsToClicksRatio =
    paid.clicks > 0 ? paid.sessions / paid.clicks : null;

  const now = Date.now();
  const hoursSince = (date: Date | null) =>
    date ? Math.floor((now - date.getTime()) / 3_600_000) : null;
  const dayN = idea.adsLaunchedAt
    ? Math.max(1, Math.floor((now - idea.adsLaunchedAt.getTime()) / 86_400_000) + 1)
    : null;

  return {
    idea,
    range,
    channel: params.channel,
    counts,
    byChannel,
    health,
    verdict,
    channelKillBreached,
    daily,
    dayN,
    quality: {
      ...quality,
      sessionsToClicksRatio,
      staleAdsHours: hoursSince(quality.adsSyncedAt),
      staleGa4Hours: hoursSince(quality.ga4SyncedAt),
    },
  };
}

// The "death" line of the last bounded band (HOLD_FIX upper edge) is the kill
// threshold the zero-customer exception checks against.
function lastBandEdge(bands: CacBand[]): number | null {
  let edge: number | null = null;
  for (const band of bands) {
    if (band.cacMaxCents != null) edge = band.cacMaxCents;
  }
  return edge;
}
