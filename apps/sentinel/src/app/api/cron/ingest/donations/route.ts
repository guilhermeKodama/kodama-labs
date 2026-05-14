import { NextRequest } from "next/server";
import { ingestDonations } from "@sentinel/server/modules/pipeline/ingestion/ingest-donations";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "donations", ingestDonations);
}
