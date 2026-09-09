import { NextRequest } from "next/server";
import { ingestNews } from "@sentinel/server/modules/pipeline/ingestion/ingest-news";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "news", ingestNews);
}
