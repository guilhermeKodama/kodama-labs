import { NextRequest } from "next/server";
import { runIngestion } from "../../_runner";
import { runJob } from "@pipeline/server/lib/job-runner";
import { ingestGa4 } from "@pipeline/server/modules/ga4/ingest";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // ?start=YYYY-MM-DD backfills from an explicit date (first sync of an idea
  // whose ads ran before the dashboard existed).
  const start = request.nextUrl.searchParams.get("start") ?? undefined;
  return runIngestion(request, "ingest-ga4", () =>
    runJob("ingest-ga4", "ingest", () => ingestGa4(start)),
  );
}
