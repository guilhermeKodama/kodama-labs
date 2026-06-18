import { NextRequest } from "next/server";
import { runIngestion } from "../../_runner";
import { runJob } from "@pipeline/server/lib/job-runner";
import { ingestGoogleAds } from "@pipeline/server/modules/ad-spend/ingest-google";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const days = Number(request.nextUrl.searchParams.get("days") ?? 7);
  return runIngestion(request, "ingest-google-ads", () =>
    runJob("ingest-google-ads", "ingest", () => ingestGoogleAds(days)),
  );
}
