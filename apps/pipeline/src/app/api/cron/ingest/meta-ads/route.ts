import { NextRequest } from "next/server";
import { runIngestion } from "../../_runner";
import { runJob } from "@pipeline/server/lib/job-runner";
import { ingestMetaAds } from "@pipeline/server/modules/ad-spend/ingest-meta";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // No param → incremental (backfill on first run, then trailing overlap).
  // ?days=N forces a fixed N-day window for a manual re-backfill.
  const daysParam = request.nextUrl.searchParams.get("days");
  const days = daysParam ? Number(daysParam) : undefined;
  return runIngestion(request, "ingest-meta-ads", () =>
    runJob("ingest-meta-ads", "ingest", () => ingestMetaAds(days)),
  );
}
