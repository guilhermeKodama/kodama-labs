import { createHash } from "node:crypto";
import { prisma } from "@pipeline/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import type { IdeaStatus, MetricKey, ThresholdChannel } from "@/generated/prisma";
import type { IdeaConfig, SyncPayload } from "./schema";

export type SyncAction =
  | "created"
  | "updated"
  | "unchanged"
  | "archived"
  | "unarchived";

export interface SyncResult {
  slug: string;
  action: SyncAction;
}

const STATUS_MAP: Record<IdeaConfig["status"], IdeaStatus> = {
  hypothesis: "HYPOTHESIS",
  validating: "VALIDATING",
  validated: "VALIDATED",
  killed: "KILLED",
  paused: "PAUSED",
};

const toCents = (brl: number | null | undefined): number | null =>
  brl == null ? null : Math.round(brl * 100);

function configHash(config: IdeaConfig): string {
  return createHash("sha256").update(JSON.stringify(config)).digest("hex");
}

interface ThresholdRow {
  metric: MetricKey;
  channel: ThresholdChannel;
  healthyValue: number;
  deathValue: number;
}

// funnel_targets (fractions) + economics (BRL) → normalized threshold rows.
// CPL gets a row when the per-lead ceiling exists: death = ceiling, healthy =
// ceiling/2 (the Sheets model only defines the kill line; half is the
// "comfortably under" convention, surfaced in the UI as derived).
function desiredThresholds(config: IdeaConfig): ThresholdRow[] {
  const rows: ThresholdRow[] = [];
  const targets = config.funnel_targets;
  const pair = (
    metric: MetricKey,
    channel: ThresholdChannel,
    p: { healthy: number; death: number } | undefined,
  ) => {
    if (p) rows.push({ metric, channel, healthyValue: p.healthy, deathValue: p.death });
  };

  pair("CTR", "ALL", targets?.ctr);
  pair("CTR", "GOOGLE", targets?.ctr_google);
  pair("BOUNCE_RATE", "ALL", targets?.bounce);
  pair("SESSION_TO_LEAD", "ALL", targets?.session_to_lead);
  pair("AR", "ALL", targets?.ar);
  pair("PCR", "ALL", targets?.pcr);

  const cplCeilingCents = toCents(config.economics?.cac_ceiling_per_lead);
  if (cplCeilingCents != null) {
    rows.push({
      metric: "CPL",
      channel: "ALL",
      healthyValue: Math.round(cplCeilingCents / 2),
      deathValue: cplCeilingCents,
    });
  }

  return rows;
}

// decision_matrix (BRL, fractions) → cacBands JSON [{cacMaxCents, arMin, decision}]
// decisions stored UPPERCASE to match the health engine's CacDecision enum.
function toCacBands(config: IdeaConfig): Prisma.InputJsonValue | undefined {
  if (!config.decision_matrix) return undefined;
  return config.decision_matrix.map((band) => ({
    cacMaxCents: toCents(band.cac_max ?? null),
    arMin: band.ar_min ?? null,
    decision: band.decision.toUpperCase(),
  }));
}

// gates: money metrics (cac, cpl) → cents; ratios stay fractions. Manual items
// keep their checkedAt — preserved from the existing row by label match so a
// re-sync never unchecks a gate the user ticked in the UI.
function toGates(
  config: IdeaConfig,
  existing: Prisma.JsonValue | null,
): Prisma.InputJsonValue | undefined {
  if (!config.gates) return undefined;

  const previousChecked = new Map<string, string>();
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    for (const list of Object.values(existing as Record<string, unknown>)) {
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        if (
          item &&
          typeof item === "object" &&
          "manual" in item &&
          "label" in item &&
          typeof (item as { label: unknown }).label === "string" &&
          typeof (item as { checkedAt?: unknown }).checkedAt === "string"
        ) {
          previousChecked.set(
            (item as { label: string }).label,
            (item as { checkedAt: string }).checkedAt,
          );
        }
      }
    }
  }

  const mapItem = (item: NonNullable<IdeaConfig["gates"]>["go"][number]) => {
    if ("manual" in item) {
      return {
        label: item.label,
        manual: true as const,
        checkedAt: item.checkedAt ?? previousChecked.get(item.label) ?? null,
      };
    }
    const isMoney = item.metric === "cac" || item.metric === "cpl";
    return {
      metric: item.metric,
      op: item.op,
      value: isMoney ? Math.round(item.value * 100) : item.value,
      unit: isMoney ? ("cents" as const) : ("ratio" as const),
      label: item.label ?? null,
    };
  };

  return {
    go: config.gates.go.map(mapItem),
    pivot: config.gates.pivot.map(mapItem),
    kill: config.gates.kill.map(mapItem),
  };
}

export async function syncIdeas(payload: SyncPayload): Promise<{
  results: SyncResult[];
  syncedAt: string;
}> {
  const results: SyncResult[] = [];
  const syncedAt = new Date();
  const fromCi = payload.source.commitSha != null;

  await prisma.$transaction(async (tx) => {
    for (const { slug, config } of payload.ideas) {
      const hash = configHash(config);
      const existing = await tx.idea.findUnique({
        where: { slug },
        select: { id: true, status: true, configHash: true, gates: true },
      });

      if (existing && existing.configHash === hash && existing.status !== "ARCHIVED") {
        results.push({ slug, action: "unchanged" });
        continue;
      }

      const status = STATUS_MAP[config.status];
      const data = {
        name: config.name,
        status,
        isLive: status === "VALIDATING",
        landingUrl: config.landing_url,
        timezone: config.timezone,
        priceMonthlyCents: toCents(config.economics?.price_monthly),
        projectedLtvCents: toCents(config.economics?.projected_ltv),
        maxCacCents: toCents(config.economics?.max_cac),
        cacCeilingLeadCents: toCents(config.economics?.cac_ceiling_per_lead),
        channelKillCacCents: toCents(config.economics?.channel_kill_cac),
        cacBands: toCacBands(config),
        gates: toGates(config, existing?.gates ?? null),
        metaAdAccountId: config.ads?.meta_ad_account_id ?? null,
        googleCustomerId: config.ads?.google_customer_id ?? null,
        googleCampaignPrefix: config.ads?.google_campaign_prefix ?? slug,
        ga4PropertyId: config.tracking?.ga4_property_id ?? null,
        adsLaunchedAt: config.ads_launched_at,
        goNoGoAt: config.go_no_go_at,
        budgetTotalCents: toCents(config.budget?.total),
        budgetWeeks: config.budget?.weeks ?? null,
        configHash: hash,
        rawConfig: config as unknown as Prisma.InputJsonValue,
        syncedAt,
        lastSyncCommit: payload.source.commitSha,
      };

      const idea = existing
        ? await tx.idea.update({ where: { id: existing.id }, data })
        : await tx.idea.create({ data: { slug, ...data } });

      // Thresholds: upsert desired rows unless the user hand-tuned them
      // (source MANUAL); drop CONFIG/DEFAULT rows the config no longer defines.
      const desired = desiredThresholds(config);
      const current = await tx.metricThreshold.findMany({
        where: { ideaId: idea.id },
      });
      const desiredKeys = new Set(desired.map((d) => `${d.metric}|${d.channel}`));

      for (const row of desired) {
        const match = current.find(
          (c) => c.metric === row.metric && c.channel === row.channel,
        );
        if (match?.source === "MANUAL") continue;
        await tx.metricThreshold.upsert({
          where: {
            ideaId_metric_channel: {
              ideaId: idea.id,
              metric: row.metric,
              channel: row.channel,
            },
          },
          create: {
            ideaId: idea.id,
            metric: row.metric,
            channel: row.channel,
            healthyValue: row.healthyValue,
            deathValue: row.deathValue,
            source: "CONFIG",
          },
          update: {
            healthyValue: row.healthyValue,
            deathValue: row.deathValue,
            source: "CONFIG",
          },
        });
      }
      for (const row of current) {
        if (row.source === "MANUAL") continue;
        if (!desiredKeys.has(`${row.metric}|${row.channel}`)) {
          await tx.metricThreshold.delete({ where: { id: row.id } });
        }
      }

      results.push({
        slug,
        action: existing
          ? existing.status === "ARCHIVED"
            ? "unarchived"
            : "updated"
          : "created",
      });
    }

    // Archive on absence — the payload is a full snapshot of ideas/, so a
    // synced idea missing from ideas ∪ skipped was deleted/renamed. Only CI
    // runs (commitSha present) may archive; local syncs are upsert-only.
    if (fromCi) {
      const present = new Set([
        ...payload.ideas.map((i) => i.slug),
        ...payload.skipped,
      ]);
      const candidates = await tx.idea.findMany({
        where: { status: { not: "ARCHIVED" }, rawConfig: { not: Prisma.DbNull } },
        select: { id: true, slug: true },
      });
      for (const idea of candidates) {
        if (!present.has(idea.slug)) {
          await tx.idea.update({
            where: { id: idea.id },
            data: { status: "ARCHIVED", isLive: false, syncedAt },
          });
          results.push({ slug: idea.slug, action: "archived" });
        }
      }
    }
  });

  return { results, syncedAt: syncedAt.toISOString() };
}
