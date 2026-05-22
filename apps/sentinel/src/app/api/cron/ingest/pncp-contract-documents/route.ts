import { NextRequest } from "next/server";
import { ingestPncpContractDocuments } from "@sentinel/server/modules/pipeline/ingestion/ingest-pncp-contract-documents";
import { runIngestion } from "../_runner";

export const maxDuration = 300;

export async function GET(request: NextRequest) {
  return runIngestion(request, "pncpContractDocuments", ingestPncpContractDocuments);
}
