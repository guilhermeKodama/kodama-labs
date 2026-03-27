import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { fetchCnpjData } from "@/lib/gov-apis/cnpj";

const BATCH_SIZE = 20;
const DELAY_MS = 1000;
const MAX_RETRIES = 3;

export async function ingestCnpj() {
  return runJob("ingest-cnpj", "ingestion", async () => {
    const entitiesToEnrich = await prisma.entity.findMany({
      where: { enrichedAt: null },
      select: { cnpj: true },
      take: BATCH_SIZE,
    });

    if (entitiesToEnrich.length === 0) {
      return { recordsIn: 0, recordsOut: 0 };
    }

    let totalOut = 0;

    for (const entity of entitiesToEnrich) {
      const cleanCnpj = entity.cnpj.replace(/\D/g, "");

      if (cleanCnpj.length !== 14) {
        await prisma.entity.update({
          where: { cnpj: entity.cnpj },
          data: { enrichedAt: new Date() },
        });
        continue;
      }

      const existingRaw = await prisma.rawRecord.findUnique({
        where: {
          source_recordType_externalId: {
            source: "CNPJ",
            recordType: "entity",
            externalId: cleanCnpj,
          },
        },
        select: { processingError: true },
      });

      if (existingRaw?.processingError) {
        const retryCount = (existingRaw.processingError.match(/\[retry:/)?.[0]
          ? parseInt(existingRaw.processingError.split("[retry:")[1]) || 0
          : 0);
        if (retryCount >= MAX_RETRIES) {
          await prisma.entity.update({
            where: { cnpj: entity.cnpj },
            data: { enrichedAt: new Date() },
          });
          continue;
        }
      }

      try {
        const cnpjData = await fetchCnpjData(cleanCnpj);

        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "CNPJ",
              recordType: "entity",
              externalId: cleanCnpj,
            },
          },
          create: {
            source: "CNPJ",
            recordType: "entity",
            externalId: cleanCnpj,
            data: cnpjData as unknown as Prisma.InputJsonValue,
          },
          update: {
            data: cnpjData as unknown as Prisma.InputJsonValue,
            fetchedAt: new Date(),
            processedAt: null,
            processingError: null,
          },
        });

        await prisma.entity.update({
          where: { cnpj: entity.cnpj },
          data: { enrichedAt: new Date() },
        });

        totalOut++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        console.warn(`[ingest-cnpj] Failed for ${cleanCnpj}: ${msg}`);

        const currentRetry = existingRaw?.processingError
          ? parseInt(existingRaw.processingError.split("[retry:")[1]) || 0
          : 0;
        const nextRetry = currentRetry + 1;

        await prisma.rawRecord.upsert({
          where: {
            source_recordType_externalId: {
              source: "CNPJ",
              recordType: "entity",
              externalId: cleanCnpj,
            },
          },
          create: {
            source: "CNPJ",
            recordType: "entity",
            externalId: cleanCnpj,
            data: {} as Prisma.InputJsonValue,
            processingError: `${msg} [retry:${nextRetry}]`,
          },
          update: {
            processingError: `${msg} [retry:${nextRetry}]`,
          },
        });

        if (nextRetry >= MAX_RETRIES) {
          await prisma.entity.update({
            where: { cnpj: entity.cnpj },
            data: { enrichedAt: new Date() },
          });
        }
      }

      await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
    }

    return { recordsIn: entitiesToEnrich.length, recordsOut: totalOut };
  });
}
