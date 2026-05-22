import { createHash } from "node:crypto";
import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { BudgetTracker } from "@sentinel/server/lib/budget-tracker";
import {
  fetchContractDocuments,
  downloadProcurementDocument,
  type PncpDocument,
} from "@/lib/gov-apis/pncp";
import {
  isBlobConfigured,
  putObject,
  buildContractDocumentStoragePath,
} from "@/lib/storage/blob";

const BATCH_SIZE = 30;
const DELAY_MS = 300;
const BUDGET_MS = 270_000;
const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pickExtension(mimeType: string, title: string): string {
  if (mimeType.includes("pdf")) return "pdf";
  if (mimeType.includes("zip")) return "zip";
  if (mimeType.includes("wordprocessingml")) return "docx";
  if (mimeType.includes("msword")) return "doc";
  if (mimeType.includes("spreadsheetml")) return "xlsx";
  if (mimeType.includes("excel")) return "xls";
  const match = title.match(/\.([a-zA-Z0-9]{2,5})$/);
  return match ? match[1]!.toLowerCase() : "bin";
}

function sniffMimeFromMagic(buf: Buffer, fallback: string): string {
  if (buf.length >= 4) {
    if (buf[0] === 0x25 && buf[1] === 0x50 && buf[2] === 0x44 && buf[3] === 0x46) {
      return "application/pdf";
    }
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      if (fallback.includes("wordprocessingml")) return fallback;
      if (fallback.includes("spreadsheetml")) return fallback;
      return fallback || "application/zip";
    }
  }
  return fallback || "application/octet-stream";
}

async function streamToBuffer(
  body: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ buffer: Buffer; truncated: boolean }> {
  const chunks: Buffer[] = [];
  let total = 0;
  const reader = body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!value) continue;
      const chunk = Buffer.from(value);
      total += chunk.length;
      if (total > maxBytes) {
        return { buffer: Buffer.concat(chunks), truncated: true };
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return { buffer: Buffer.concat(chunks), truncated: false };
}

export async function ingestPncpContractDocuments() {
  return runJob("ingest-pncp-contract-documents", "ingestion", async () => {
    if (!isBlobConfigured()) {
      console.warn(
        "[ingest-pncp-contract-documents] Vercel Blob not configured (BLOB_READ_WRITE_TOKEN missing); skipping",
      );
      return { recordsIn: 0, recordsOut: 0 };
    }

    const contracts = await prisma.contract.findMany({
      where: {
        documentsEnrichedAt: null,
        year: { not: null },
        sequencial: { not: null },
        orgCnpj: { not: null },
        rawRecordId: { not: null },
      },
      select: {
        id: true,
        externalId: true,
        orgCnpj: true,
        year: true,
        sequencial: true,
      },
      take: BATCH_SIZE,
      orderBy: { startDate: "desc" },
    });

    let totalIn = 0;
    let totalOut = 0;
    const counters = {
      listsFetched: 0,
      docsDownloaded: 0,
      docsSkippedDup: 0,
      docsSkippedSize: 0,
      bytesUploaded: 0,
      errors: 0,
    };

    const budget = new BudgetTracker(BUDGET_MS);

    for (const contract of contracts) {
      if (budget.exceeded()) {
        console.log(
          `[ingest-pncp-contract-documents] Budget exhausted; ${totalOut} records saved`,
        );
        break;
      }
      if (!contract.sequencial || !contract.year || !contract.orgCnpj) continue;

      const orgCnpjDigits = contract.orgCnpj.replace(/\D/g, "");

      let documents: PncpDocument[] = [];
      try {
        documents = await fetchContractDocuments(
          orgCnpjDigits,
          contract.year,
          contract.sequencial,
        );
        counters.listsFetched++;
        totalIn += documents.length;
      } catch (err) {
        counters.errors++;
        console.warn(
          `[ingest-pncp-contract-documents] Failed to list documents for ${contract.externalId}:`,
          err instanceof Error ? err.message : err,
        );
        await sleep(DELAY_MS);
        continue;
      }

      for (const doc of documents) {
        if (budget.exceeded()) break;
        const downloadUrl = doc.url ?? doc.uri;
        if (!downloadUrl) {
          counters.errors++;
          continue;
        }

        const externalId = `${contract.externalId}-doc-${doc.sequencialDocumento}`;

        try {
          const existing = await prisma.contractDocument.findUnique({
            where: { externalId },
            select: { id: true, contentHash: true, storageKey: true },
          });

          const download = await downloadProcurementDocument(downloadUrl);

          if (
            download.contentLength &&
            download.contentLength > MAX_FILE_SIZE_BYTES
          ) {
            counters.docsSkippedSize++;
            await download.body.cancel().catch(() => {});
            await prisma.contractDocument.upsert({
              where: { externalId },
              create: {
                externalId,
                contractId: contract.id,
                source: "PNCP",
                sequencial: doc.sequencialDocumento,
                title: doc.titulo,
                documentType: doc.tipoDocumentoNome,
                mimeType: download.contentType,
                sizeBytes: download.contentLength,
                sourceUrl: downloadUrl,
                statusAtivo: doc.statusAtivo,
                publishedAt: doc.dataPublicacaoPncp
                  ? new Date(doc.dataPublicacaoPncp)
                  : null,
              },
              update: {
                sizeBytes: download.contentLength,
                mimeType: download.contentType,
                title: doc.titulo,
                documentType: doc.tipoDocumentoNome,
                statusAtivo: doc.statusAtivo,
              },
            });
            continue;
          }

          const { buffer, truncated } = await streamToBuffer(
            download.body,
            MAX_FILE_SIZE_BYTES,
          );
          if (truncated) {
            counters.docsSkippedSize++;
            continue;
          }

          const sha256 = createHash("sha256").update(buffer).digest("hex");

          if (existing?.contentHash === sha256 && existing.storageKey) {
            counters.docsSkippedDup++;
            await prisma.contractDocument.update({
              where: { externalId },
              data: {
                title: doc.titulo,
                documentType: doc.tipoDocumentoNome,
                statusAtivo: doc.statusAtivo,
                sourceUrl: downloadUrl,
              },
            });
            continue;
          }

          const detectedMime = sniffMimeFromMagic(buffer, download.contentType);
          const ext = pickExtension(detectedMime, doc.titulo);
          const pathname = buildContractDocumentStoragePath(
            contract.id,
            doc.sequencialDocumento,
            doc.titulo,
            ext,
          );

          const uploaded = await putObject(pathname, buffer, detectedMime);
          counters.bytesUploaded += buffer.length;
          counters.docsDownloaded++;

          await prisma.rawRecord.upsert({
            where: {
              source_recordType_externalId: {
                source: "PNCP",
                recordType: "contract_document",
                externalId,
              },
            },
            create: {
              source: "PNCP",
              recordType: "contract_document",
              externalId,
              data: {
                ...doc,
                _contractId: contract.id,
                _contractExternalId: contract.externalId,
                _blobUrl: uploaded.url,
                _blobPathname: uploaded.pathname,
                _contentHash: sha256,
                _sizeBytes: buffer.length,
                _mimeType: detectedMime,
              } as unknown as Prisma.InputJsonValue,
            },
            update: {
              data: {
                ...doc,
                _contractId: contract.id,
                _contractExternalId: contract.externalId,
                _blobUrl: uploaded.url,
                _blobPathname: uploaded.pathname,
                _contentHash: sha256,
                _sizeBytes: buffer.length,
                _mimeType: detectedMime,
              } as unknown as Prisma.InputJsonValue,
              fetchedAt: new Date(),
              processedAt: null,
            },
          });

          await prisma.contractDocument.upsert({
            where: { externalId },
            create: {
              externalId,
              contractId: contract.id,
              source: "PNCP",
              sequencial: doc.sequencialDocumento,
              title: doc.titulo,
              documentType: doc.tipoDocumentoNome,
              mimeType: detectedMime,
              sizeBytes: buffer.length,
              contentHash: sha256,
              sourceUrl: downloadUrl,
              storageKey: uploaded.url,
              statusAtivo: doc.statusAtivo,
              publishedAt: doc.dataPublicacaoPncp
                ? new Date(doc.dataPublicacaoPncp)
                : null,
            },
            update: {
              title: doc.titulo,
              documentType: doc.tipoDocumentoNome,
              mimeType: detectedMime,
              sizeBytes: buffer.length,
              contentHash: sha256,
              sourceUrl: downloadUrl,
              storageKey: uploaded.url,
              statusAtivo: doc.statusAtivo,
              publishedAt: doc.dataPublicacaoPncp
                ? new Date(doc.dataPublicacaoPncp)
                : null,
              fetchedAt: new Date(),
            },
          });

          totalOut++;
        } catch (err) {
          counters.errors++;
          console.warn(
            `[ingest-pncp-contract-documents] Failed to download document ${externalId}:`,
            err instanceof Error ? err.message : err,
          );
        }

        await sleep(DELAY_MS);
      }

      await prisma.contract.update({
        where: { id: contract.id },
        data: { documentsEnrichedAt: new Date() },
      });

      await sleep(DELAY_MS);
    }

    console.log(
      `[ingest-pncp-contract-documents] counters: ${JSON.stringify(counters)}`,
    );

    return {
      recordsIn: totalIn,
      recordsOut: totalOut,
      metadata: counters,
    };
  });
}
