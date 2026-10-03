import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import { sourceCredibility } from "@/lib/news/news";

const BATCH_SIZE = 50;

interface RawArticle {
  title: string;
  url: string;
  source: string;
  publishedAt: string | null;
}

/**
 * Explodes news RawRecords (one per politician, holding an article array) into
 * PoliticianNews rows, tagging each with the source's allowlist credibility.
 * Idempotent via the (politicianId, url) unique + skipDuplicates.
 */
export async function processNews() {
  return runJob("process-news", "processing", async () => {
    const raws = await prisma.rawRecord.findMany({
      where: {
        source: "NEWS",
        recordType: "news",
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!raws.length) return { recordsIn: 0, recordsOut: 0 };

    const successIds: string[] = [];
    const errs: { id: string; error: string }[] = [];
    const toCreate: Prisma.PoliticianNewsCreateManyInput[] = [];

    for (const raw of raws) {
      const politicianId = raw.externalId;
      const data = raw.data as unknown;
      if (!Array.isArray(data)) {
        successIds.push(raw.id); // { _empty: true }
        continue;
      }
      const seen = new Set<string>();
      for (const a of data as RawArticle[]) {
        if (!a.url || !a.title || seen.has(a.url)) continue;
        seen.add(a.url);
        toCreate.push({
          politicianId,
          title: a.title,
          url: a.url,
          source: a.source || "—",
          publishedAt: a.publishedAt ? new Date(a.publishedAt) : null,
          credibility: sourceCredibility(a.source || ""),
          // Name-based match; the future fake-news/relevance filter refines this.
          matchConfidence: 0.6,
          rawRecordId: raw.id,
        });
      }
      successIds.push(raw.id);
    }

    if (toCreate.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < toCreate.length; i += CHUNK) {
        try {
          await prisma.politicianNews.createMany({
            data: toCreate.slice(i, i + CHUNK),
            skipDuplicates: true,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : "createMany error";
          console.error("[process-news] createMany failed:", msg);
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

    return { recordsIn: raws.length, recordsOut: successIds.length };
  });
}
