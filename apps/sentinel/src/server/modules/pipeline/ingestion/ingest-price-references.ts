import { prisma } from "@sentinel/server/lib/prisma";
import { runJob, getOrCreateCursor, updateCursor } from "@sentinel/server/lib/job-runner";
import {
  fetchAtas,
  fetchProcurementItems,
  fetchItemResults,
  parseCompraControlNumber,
} from "@/lib/gov-apis/pncp";
import type { PncpItem } from "@/lib/gov-apis/pncp";
import { Prisma } from "@/generated/prisma";

const ATAS_PER_RUN = 15;
const DELAY_MS = 1000;
const LOOKBACK_DAYS = 365;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function normalizeDescription(desc: string): string {
  return desc
    .toUpperCase()
    .replace(/CATMAT\s*\d+/gi, "")
    .replace(/[^A-Z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function extractCatmat(item: PncpItem): string | null {
  if (item.catalogoCodigoItem) return item.catalogoCodigoItem;
  const match = item.descricao?.match(/CATMAT\s*(\d{4,8})/i);
  return match?.[1] ?? null;
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
}

export async function ingestPriceReferences() {
  return runJob("ingest-price-references", "ingestion", async () => {
    const cursor = await getOrCreateCursor(
      "PNCP",
      "atas-price-references",
      new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000),
    );

    if (cursor.status === "COMPLETED") {
      return { recordsIn: 0, recordsOut: 0 };
    }

    await updateCursor(cursor.id, { status: "RUNNING" });

    const startDate = cursor.lastFetchedAt;
    const endDate = new Date(
      Math.min(startDate.getTime() + 7 * 24 * 60 * 60 * 1000, Date.now()),
    );

    const page = cursor.cursorValue ? parseInt(cursor.cursorValue, 10) : 1;

    let totalIn = 0;
    let totalOut = 0;

    try {
      const resp = await fetchAtas(formatDate(startDate), formatDate(endDate), page);
      const atas = resp.data ?? [];
      totalIn = atas.length;

      if (atas.length === 0) {
        if (endDate.getTime() >= Date.now() - 24 * 60 * 60 * 1000) {
          await updateCursor(cursor.id, {
            status: "IDLE",
            lastFetchedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
            cursorValue: "1",
          });
        } else {
          await updateCursor(cursor.id, {
            status: "IDLE",
            lastFetchedAt: endDate,
            cursorValue: "1",
          });
        }
        return { recordsIn: 0, recordsOut: 0 };
      }

      const nonCancelled = atas.filter((a) => !a.cancelado);
      const toProcess = nonCancelled.slice(0, ATAS_PER_RUN);

      for (const ata of toProcess) {
        const parsed = parseCompraControlNumber(ata.numeroControlePNCPCompra);
        if (!parsed) continue;

        try {
          const items = await fetchProcurementItems(parsed.orgCnpj, parsed.year, parsed.sequencial);
          await sleep(DELAY_MS);

          const homologatedItems = items.filter((i) => i.temResultado && i.valorUnitarioEstimado > 0);

          for (const item of homologatedItems) {
            try {
              const results = await fetchItemResults(
                parsed.orgCnpj, parsed.year, parsed.sequencial, item.numeroItem,
              );
              await sleep(DELAY_MS);

              const winningResult = results
                .filter((r) => r.valorUnitarioHomologado > 0 && !r.motivoCancelamento)
                .sort((a, b) => a.ordemClassificacaoSrp - b.ordemClassificacaoSrp)[0];

              if (!winningResult) continue;

              const homologatedPrice = winningResult.valorUnitarioHomologado;
              const catmat = extractCatmat(item);
              const descNorm = normalizeDescription(item.descricao ?? "");
              const descPrefix = descNorm.slice(0, 80);

              const matchedItems = await findMatchingItems(catmat, descPrefix);
              if (matchedItems.length === 0) continue;

              const ataUrl = `https://pncp.gov.br/app/atas/${ata.numeroControlePNCPAta}`;

              for (const matchedItem of matchedItems) {
                const existing = await prisma.priceReference.findFirst({
                  where: {
                    itemId: matchedItem.id,
                    source: "PNCP_ATA",
                    url: ataUrl,
                  },
                });
                if (existing) continue;

                await prisma.priceReference.create({
                  data: {
                    itemId: matchedItem.id,
                    source: "PNCP_ATA",
                    price: new Prisma.Decimal(homologatedPrice),
                    fetchedAt: new Date(),
                    url: ataUrl,
                  },
                });
                totalOut++;
              }
            } catch (e) {
              console.warn(
                `[ingest-price-references] Failed to fetch results for item ${item.numeroItem} of ${ata.numeroControlePNCPCompra}:`,
                e instanceof Error ? e.message : e,
              );
            }
          }
        } catch (e) {
          console.warn(
            `[ingest-price-references] Failed to fetch items for ata ${ata.numeroControlePNCPCompra}:`,
            e instanceof Error ? e.message : e,
          );
        }
      }

      const totalPages = resp.totalPaginas ?? 1;
      const hasMorePages = page < totalPages;

      if (hasMorePages && atas.length >= 500) {
        await updateCursor(cursor.id, {
          status: "IDLE",
          cursorValue: String(page + 1),
          totalFetched: (cursor.totalFetched ?? 0) + totalOut,
        });
      } else {
        await updateCursor(cursor.id, {
          status: "IDLE",
          lastFetchedAt: endDate,
          cursorValue: "1",
          totalFetched: (cursor.totalFetched ?? 0) + totalOut,
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`[ingest-price-references] Error:`, msg);
      await updateCursor(cursor.id, { status: "FAILED", lastError: msg });
      throw e;
    }

    return { recordsIn: totalIn, recordsOut: totalOut };
  });
}

async function findMatchingItems(
  catmat: string | null,
  descPrefix: string,
): Promise<{ id: string }[]> {
  if (catmat) {
    const byCode = await prisma.procurementItem.findMany({
      where: { catmatCode: catmat, unitPrice: { gt: 0 } },
      select: { id: true },
      take: 50,
    });
    if (byCode.length > 0) return byCode;
  }

  if (descPrefix.length < 10) return [];

  return prisma.procurementItem.findMany({
    where: {
      catalogCode: { startsWith: descPrefix },
      unitPrice: { gt: 0 },
    },
    select: { id: true },
    take: 50,
  });
}
