import { NextRequest } from "next/server";
import { ingestPncpDocuments } from "@sentinel/server/modules/pipeline/ingestion/ingest-pncp-documents";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "pncpDocuments", ingestPncpDocuments);
}
