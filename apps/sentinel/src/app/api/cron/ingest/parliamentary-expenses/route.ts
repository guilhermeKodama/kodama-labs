import { NextRequest } from "next/server";
import { ingestParliamentaryExpenses } from "@sentinel/server/modules/pipeline/ingestion/ingest-parliamentary-expenses";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(
    request,
    "parliamentary-expenses",
    ingestParliamentaryExpenses,
  );
}
