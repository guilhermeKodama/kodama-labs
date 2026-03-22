import { prisma } from "@sentinel/server/lib/prisma";
import { Prisma } from "@/generated/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { fetchProcurementItems, fetchItemResults } from "@/lib/gov-apis/pncp";

const BATCH_SIZE = 30;
const DELAY_MS = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function ingestPncpDetails() {
  return runJob("ingest-pncp-details", "ingestion", async () => {
    const procurements = await prisma.procurement.findMany({
      where: {
        itemsEnrichedAt: null,
        source: "PNCP",
        sequencial: { not: null },
      },
      select: {
        id: true,
        externalId: true,
        orgCnpj: true,
        year: true,
        sequencial: true,
      },
      take: BATCH_SIZE,
      orderBy: { processedAt: "asc" },
    });

    let totalIn = 0;
    let totalOut = 0;

    for (const proc of procurements) {
      if (!proc.sequencial || !proc.orgCnpj) continue;

      try {
        const items = await fetchProcurementItems(
          proc.orgCnpj,
          proc.year,
          proc.sequencial
        );
        totalIn += items.length;

        for (const item of items) {
          const externalId = `${proc.externalId}-item-${item.numeroItem}`;

          await prisma.rawRecord.upsert({
            where: {
              source_recordType_externalId: {
                source: "PNCP",
                recordType: "procurement_item",
                externalId,
              },
            },
            create: {
              source: "PNCP",
              recordType: "procurement_item",
              externalId,
              data: {
                ...item,
                _procurementId: proc.id,
                _procurementExternalId: proc.externalId,
                _orgCnpj: proc.orgCnpj,
                _year: proc.year,
                _sequencial: proc.sequencial,
              } as unknown as Prisma.InputJsonValue,
            },
            update: {
              data: {
                ...item,
                _procurementId: proc.id,
                _procurementExternalId: proc.externalId,
                _orgCnpj: proc.orgCnpj,
                _year: proc.year,
                _sequencial: proc.sequencial,
              } as unknown as Prisma.InputJsonValue,
              fetchedAt: new Date(),
              processedAt: null,
            },
          });
          totalOut++;

          if (item.temResultado) {
            try {
              const results = await fetchItemResults(
                proc.orgCnpj,
                proc.year,
                proc.sequencial,
                item.numeroItem
              );

              for (const result of results) {
                const resultExternalId = `${proc.externalId}-item-${item.numeroItem}-result-${result.sequencialResultado}`;

                await prisma.rawRecord.upsert({
                  where: {
                    source_recordType_externalId: {
                      source: "PNCP",
                      recordType: "bid_result",
                      externalId: resultExternalId,
                    },
                  },
                  create: {
                    source: "PNCP",
                    recordType: "bid_result",
                    externalId: resultExternalId,
                    data: {
                      ...result,
                      _procurementId: proc.id,
                      _procurementExternalId: proc.externalId,
                      _itemExternalId: externalId,
                      _itemNumber: item.numeroItem,
                    } as unknown as Prisma.InputJsonValue,
                  },
                  update: {
                    data: {
                      ...result,
                      _procurementId: proc.id,
                      _procurementExternalId: proc.externalId,
                      _itemExternalId: externalId,
                      _itemNumber: item.numeroItem,
                    } as unknown as Prisma.InputJsonValue,
                    fetchedAt: new Date(),
                    processedAt: null,
                  },
                });
                totalOut++;
              }
            } catch (e) {
              console.warn(
                `[ingest-pncp-details] Failed to fetch results for item ${item.numeroItem} of ${proc.externalId}:`,
                e instanceof Error ? e.message : e
              );
            }

            await sleep(DELAY_MS);
          }
        }

        await prisma.procurement.update({
          where: { id: proc.id },
          data: { itemsEnrichedAt: new Date() },
        });

        await sleep(DELAY_MS);
      } catch (e) {
        console.warn(
          `[ingest-pncp-details] Failed to fetch items for ${proc.externalId}:`,
          e instanceof Error ? e.message : e
        );
        await prisma.procurement.update({
          where: { id: proc.id },
          data: { itemsEnrichedAt: new Date() },
        });
      }
    }

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}
