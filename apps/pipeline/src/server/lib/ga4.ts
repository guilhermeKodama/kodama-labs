import { BetaAnalyticsDataClient } from "@google-analytics/data";
import { env } from "@/env";

// One service account, shared across ideas — GA4 access is granted per
// property to the SA's email (Viewer), not via GCP IAM. The JSON key travels
// base64-encoded in env because raw multi-line private keys get mangled by
// env UIs.
let _client: BetaAnalyticsDataClient | null = null;

export function ga4Client(): BetaAnalyticsDataClient {
  if (_client) return _client;
  const b64 = env.GA4_SA_KEY_BASE64;
  if (!b64) throw new Error("GA4_SA_KEY_BASE64 not configured");
  const creds = JSON.parse(Buffer.from(b64, "base64").toString("utf8")) as {
    client_email: string;
    private_key: string;
    project_id: string;
  };
  _client = new BetaAnalyticsDataClient({
    credentials: {
      client_email: creds.client_email,
      private_key: creds.private_key,
    },
    projectId: creds.project_id,
  });
  return _client;
}

export interface Ga4DailyRow {
  date: string; // YYYY-MM-DD (GA4 returns YYYYMMDD; normalized here)
  source: string;
  medium: string;
  sessions: number;
  engagedSessions: number;
  totalUsers: number;
}

export async function fetchDailySessions(
  propertyId: string,
  startDate: string,
  endDate: string,
): Promise<Ga4DailyRow[]> {
  const [res] = await ga4Client().runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate, endDate }],
    dimensions: [{ name: "date" }, { name: "sessionSource" }, { name: "sessionMedium" }],
    metrics: [{ name: "sessions" }, { name: "engagedSessions" }, { name: "totalUsers" }],
    limit: 10_000, // LP traffic is tens of rows; never paginates at this scale
  });

  return (res.rows ?? []).map((r) => {
    const raw = r.dimensionValues?.[0]?.value ?? "";
    return {
      date: `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`,
      source: (r.dimensionValues?.[1]?.value ?? "").toLowerCase(),
      medium: (r.dimensionValues?.[2]?.value ?? "").toLowerCase(),
      sessions: Number(r.metricValues?.[0]?.value ?? 0),
      engagedSessions: Number(r.metricValues?.[1]?.value ?? 0),
      totalUsers: Number(r.metricValues?.[2]?.value ?? 0),
    };
  });
}
