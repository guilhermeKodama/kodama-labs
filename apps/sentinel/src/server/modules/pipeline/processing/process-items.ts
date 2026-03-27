import { prisma } from "@sentinel/server/lib/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import type { PncpItem, PncpBidResult } from "@/lib/gov-apis/pncp";

const BATCH_SIZE = 500;

function extractCatmatFromDescription(desc: string): string | null {
  const match = desc.match(/CATMAT\s*(\d{4,8})/i);
  return match?.[1] ?? null;
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

interface RawItemData extends PncpItem {
  _procurementId: string;
  _procurementExternalId: string;
  _orgCnpj: string;
  _year: number;
  _sequencial: number;
}

interface RawBidResultData extends PncpBidResult {
  _procurementId: string;
  _procurementExternalId: string;
  _itemExternalId: string;
  _itemNumber: number;
}

export async function processItems() {
  return runJob("process-items", "processing", async () => {
    let recordsOut = 0;

    const unprocessedItems = await prisma.rawRecord.findMany({
      where: {
        recordType: "procurement_item",
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    const itemSuccess: string[] = [];
    const itemErrors: { id: string; error: string }[] = [];

    for (const raw of unprocessedItems) {
      try {
        const data = raw.data as unknown as RawItemData;
        const catmat = data.catalogoCodigoItem ?? extractCatmatFromDescription(data.descricao ?? "");
        const descNorm = normalizeDescription(data.descricao ?? "");

        await prisma.procurementItem.upsert({
          where: { externalId: raw.externalId },
          create: {
            externalId: raw.externalId,
            procurementId: data._procurementId,
            itemNumber: data.numeroItem,
            description: data.descricao,
            quantity: data.quantidade,
            unitPrice: data.valorUnitarioEstimado,
            totalPrice: data.valorTotal,
            unit: data.unidadeMedida,
            catmatCode: catmat ?? null,
            ncmCode: data.ncmNbsCodigo ?? null,
            catalogCode: descNorm || null,
            materialOrService: data.materialOuServico ?? null,
            materialOrServiceName: data.materialOuServicoNome ?? null,
            situationId: data.situacaoCompraItem ?? null,
            situationName: data.situacaoCompraItemNome ?? null,
            judgmentCriteria: data.criterioJulgamentoNome ?? null,
            judgmentCriteriaId: data.criterioJulgamentoId ?? null,
            benefitType: data.tipoBeneficioNome ?? null,
            hasResult: data.temResultado ?? false,
          },
          update: {
            description: data.descricao,
            quantity: data.quantidade,
            unitPrice: data.valorUnitarioEstimado,
            totalPrice: data.valorTotal,
            unit: data.unidadeMedida,
            catmatCode: catmat ?? undefined,
            catalogCode: descNorm || undefined,
            situationId: data.situacaoCompraItem ?? null,
            situationName: data.situacaoCompraItemNome ?? null,
            hasResult: data.temResultado ?? false,
          },
        });

        itemSuccess.push(raw.id);
        recordsOut++;
      } catch (error) {
        itemErrors.push({
          id: raw.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    await markProcessed(itemSuccess);
    await markErrors(itemErrors);

    const unprocessedResults = await prisma.rawRecord.findMany({
      where: {
        recordType: "bid_result",
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    const bidItemExtIds = unprocessedResults.map(
      (r) => (r.data as unknown as RawBidResultData)._itemExternalId
    ).filter(Boolean);

    const itemMap = new Map<string, string>();
    if (bidItemExtIds.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < bidItemExtIds.length; i += CHUNK) {
        const items = await prisma.procurementItem.findMany({
          where: { externalId: { in: bidItemExtIds.slice(i, i + CHUNK) } },
          select: { id: true, externalId: true },
        });
        for (const it of items) itemMap.set(it.externalId, it.id);
      }
    }

    const bidSuccess: string[] = [];
    const bidErrors: { id: string; error: string }[] = [];
    const entityCnpjs = new Set<string>();

    for (const raw of unprocessedResults) {
      try {
        const data = raw.data as unknown as RawBidResultData;
        const itemId = itemMap.get(data._itemExternalId);

        if (!itemId) {
          bidSuccess.push(raw.id);
          continue;
        }

        const supplierCnpj = (data.niFornecedor ?? "").replace(/\D/g, "");
        if (!supplierCnpj) {
          bidSuccess.push(raw.id);
          continue;
        }

        if (!entityCnpjs.has(supplierCnpj)) {
          entityCnpjs.add(supplierCnpj);
          try {
            await prisma.entity.upsert({
              where: { cnpj: supplierCnpj },
              create: { cnpj: supplierCnpj, name: data.nomeRazaoSocialFornecedor ?? "Desconhecido" },
              update: {},
            });
          } catch {
            // entity may already exist
          }
        }

        await prisma.bidResult.upsert({
          where: {
            itemId_sequencial: {
              itemId,
              sequencial: data.sequencialResultado,
            },
          },
          create: {
            itemId,
            sequencial: data.sequencialResultado,
            supplierCnpj,
            supplierName: data.nomeRazaoSocialFornecedor ?? "Desconhecido",
            supplierSize: data.porteFornecedorNome ?? null,
            supplierType: data.tipoPessoa ?? null,
            countryCode: data.codigoPais ?? null,
            unitPrice: data.valorUnitarioHomologado,
            totalPrice: data.valorTotalHomologado,
            quantity: data.quantidadeHomologada ?? null,
            discount: data.percentualDesconto ?? null,
            ranking: data.ordemClassificacaoSrp ?? null,
            isSubcontracted: data.indicadorSubcontratacao ?? false,
            resultDate: data.dataResultado ? new Date(data.dataResultado) : null,
            situationId: data.situacaoCompraItemResultadoId ?? null,
            situationName: data.situacaoCompraItemResultadoNome ?? null,
          },
          update: {
            supplierName: data.nomeRazaoSocialFornecedor ?? "Desconhecido",
            unitPrice: data.valorUnitarioHomologado,
            totalPrice: data.valorTotalHomologado,
            quantity: data.quantidadeHomologada ?? null,
            discount: data.percentualDesconto ?? null,
            situationName: data.situacaoCompraItemResultadoNome ?? null,
          },
        });

        bidSuccess.push(raw.id);
        recordsOut++;
      } catch (error) {
        bidErrors.push({
          id: raw.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    await markProcessed(bidSuccess);
    await markErrors(bidErrors);

    return {
      recordsIn: unprocessedItems.length + unprocessedResults.length,
      recordsOut,
    };
  });
}
