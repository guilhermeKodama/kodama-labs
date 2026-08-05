import { env } from "@/env";

// Plain-fetch client for the one Marketing API surface we use. The official
// Node SDK is thousands of auto-generated classes that lag Graph versions —
// for a single GET endpoint family it buys nothing.
const META_VERSION = "v25.0";
const BASE = `https://graph.facebook.com/${META_VERSION}`;

export class MetaApiError extends Error {
  code: number | undefined;
  constructor(error: { message?: string; code?: number; type?: string }) {
    super(`Meta API error ${error.code ?? "?"}: ${error.message ?? "unknown"}`);
    this.name = "MetaApiError";
    this.code = error.code;
  }
  get isAuthError() {
    return this.code === 190; // OAuthException — token dead/rotated
  }
}

function token(): string {
  const t = env.META_SYSTEM_USER_TOKEN;
  if (!t) throw new Error("META_SYSTEM_USER_TOKEN not configured");
  return t;
}

async function metaGet(url: string): Promise<Record<string, unknown>> {
  const res = await fetch(url);
  const body = (await res.json()) as Record<string, unknown>;
  if (body.error) throw new MetaApiError(body.error as { message?: string; code?: number });
  return body;
}

export interface MetaAccountInfo {
  currency: string;
  timezoneName: string;
}

export async function fetchMetaAccountInfo(
  adAccountId: string,
): Promise<MetaAccountInfo> {
  const body = await metaGet(
    `${BASE}/${adAccountId}?` +
      new URLSearchParams({
        fields: "currency,timezone_name",
        access_token: token(),
      }),
  );
  return {
    currency: String(body.currency ?? ""),
    timezoneName: String(body.timezone_name ?? ""),
  };
}

export interface MetaInsightRow {
  campaign_id: string;
  campaign_name: string;
  spend: string; // decimal string in account currency
  impressions: string;
  clicks: string;
  date_start: string; // YYYY-MM-DD in the account's timezone
}

// Daily campaign-level raw counts. Only raw fields — CPM/CTR are computed by
// the health engine so API and manual rows share one definition.
export async function fetchMetaDailyInsights(
  adAccountId: string,
  since: string,
  until: string,
): Promise<MetaInsightRow[]> {
  const rows: MetaInsightRow[] = [];
  let url: string | null =
    `${BASE}/${adAccountId}/insights?` +
    new URLSearchParams({
      level: "campaign",
      fields: "campaign_id,campaign_name,spend,impressions,clicks",
      time_increment: "1",
      time_range: JSON.stringify({ since, until }),
      limit: "500",
      access_token: token(),
    });

  while (url) {
    const body = await metaGet(url);
    rows.push(...((body.data ?? []) as MetaInsightRow[]));
    url = (body.paging as { next?: string } | undefined)?.next ?? null;
  }
  return rows;
}
