import { NextRequest } from "next/server";
import { runIngestion } from "../../_runner";
import { runJob } from "@pipeline/server/lib/job-runner";
import { ingestMetaAds } from "@pipeline/server/modules/ad-spend/ingest-meta";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const days = Number(request.nextUrl.searchParams.get("days") ?? 7);
  return runIngestion(request, "ingest-meta-ads", () =>
    runJob("ingest-meta-ads", "ingest", () => ingestMetaAds(days)),
  );
}
