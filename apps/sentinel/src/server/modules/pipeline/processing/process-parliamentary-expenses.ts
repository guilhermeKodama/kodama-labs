import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import { getExternalIdToPoliticianId } from "@sentinel/server/lib/politician-cache";

const BATCH_SIZE = 100;

interface RawExpense {
  year: number;
  month: number;
  category: string;
  documentId: string | null;
  documentDate: string | null;
  amount: number;
  supplierName: string;
  supplierDoc: string | null;
  documentUrl: string | null;
}

/**
 * Explodes CEAP RawRecords (one per deputy-year, holding an expense array) into
 * ParliamentaryExpense rows. Resolves deputy id → politicianId via the
 * externalId cache. Idempotent via the (house, documentId) unique + skipDuplicates.
 */
export async function processParliamentaryExpenses() {
  return runJob("process-parliamentary-expenses", "processing", async () => {
    const rawRecords = await prisma.rawRecord.findMany({
      where: {
        source: "CAMARA_LEGISLATIVE",
        recordType: "expense",
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!rawRecords.length) return { recordsIn: 0, recordsOut: 0 };

    const extIdToPolId = await getExternalIdToPoliticianId();

    const successIds: string[] = [];
    const errs: { id: string; error: string }[] = [];
    const toCreate: Prisma.ParliamentaryExpenseCreateManyInput[] = [];

    for (const raw of rawRecords) {
      const deputyId = raw.externalId.split("-")[0]!;
      const politicianId = extIdToPolId.get(deputyId);

      if (!politicianId) {
        errs.push({ id: raw.id, error: `No politician for deputy ${deputyId}` });
        continue;
      }

      const data = raw.data as unknown;
      if (!Array.isArray(data)) {
        successIds.push(raw.id); // { _empty: true }
        continue;
      }

      for (const e of data as RawExpense[]) {
        if (!e.documentId) continue; // need a stable natural key for idempotency
        toCreate.push({
          politicianId,
          house: "CAMARA",
          year: Number(e.year) || 0,
          month: Number(e.month) || 0,
          category: e.category ?? "",
          supplierName: e.supplierName ?? "",
          supplierDoc: e.supplierDoc ?? null,
          amount: new Prisma.Decimal(e.amount ?? 0),
          documentDate: e.documentDate ? new Date(e.documentDate) : null,
          documentId: e.documentId,
          documentUrl: e.documentUrl ?? null,
          rawRecordId: raw.id,
        });
      }
      successIds.push(raw.id);
    }

    if (toCreate.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        try {
          await prisma.parliamentaryExpense.createMany({
            data: toCreate.slice(i, i + CHUNK),
            skipDuplicates: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "createMany error";
          console.error(
            "[process-parliamentary-expenses] createMany failed:",
            msg,
          );
          const failedRawIds = new Set(
            toCreate.slice(i, i + CHUNK).map((r) => r.rawRecordId!),
          );
          for (const rid of failedRawIds) {
            const idx = successIds.indexOf(rid);
            if (idx !== -1) successIds.splice(idx, 1);
            errs.push({ id: rid, error: msg });
          }
        }
      }
    }

    await markProcessed(successIds);
    await markErrors(errs);

    return { recordsIn: rawRecords.length, recordsOut: successIds.length };
  });
}
