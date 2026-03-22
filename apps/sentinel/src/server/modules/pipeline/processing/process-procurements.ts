import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import type { PncpProcurement } from "@/lib/gov-apis/pncp";
import { Prisma } from "@/generated/prisma";

const BATCH_SIZE = 100;

export async function processProcurements() {
  return runJob("process-procurements", "processing", async () => {
    const unprocessed = await prisma.rawRecord.findMany({
      where: {
        recordType: "procurement",
        processedAt: null,
        processingError: null,
      },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    let recordsOut = 0;

    for (const raw of unprocessed) {
      try {
        const data = raw.data as unknown as PncpProcurement;
        const externalId = raw.externalId;

        await prisma.procurement.upsert({
          where: { externalId },
          create: {
            externalId,
            source: raw.source,
            orgCnpj: data.orgaoEntidade.cnpj,
            orgName: data.orgaoEntidade.razaoSocial,
            orgPower: data.orgaoEntidade.poderId ?? null,
            orgSphere: data.orgaoEntidade.esferaId ?? null,
            unitName: data.unidadeOrgao?.nomeUnidade ?? null,
            unitCode: data.unidadeOrgao?.codigoUnidade ?? null,
            ibgeCode: data.unidadeOrgao?.codigoIbge ?? null,
            year: data.anoCompra,
            number: data.numeroCompra ?? data.sequencialCompra?.toString() ?? "",
            sequencial: data.sequencialCompra,
            modality: data.modalidadeNome,
            modalityId: data.modalidadeId,
            description: data.objetoCompra,
            publishedAt: new Date(data.dataPublicacaoPncp),
            status: data.situacaoCompraNome,
            statusId: data.situacaoCompraId,
            estimatedValue: data.valorTotalEstimado != null ? data.valorTotalEstimado : undefined,
            approvedValue: data.valorTotalHomologado != null ? data.valorTotalHomologado : undefined,
            totalValue: data.valorTotalHomologado ?? data.valorTotalEstimado ?? undefined,
            processo: data.processo ?? null,
            legalBasis: data.amparoLegal?.nome ?? null,
            legalBasisDescription: data.amparoLegal?.descricao ?? null,
            disputeMode: data.modoDisputaNome ?? null,
            disputeModeId: data.modoDisputaId ?? null,
            isSrp: data.srp ?? null,
            instrumentType: data.tipoInstrumentoConvocatorioNome ?? null,
            instrumentTypeId: data.tipoInstrumentoConvocatorioCodigo ?? null,
            proposalOpenDate: data.dataAberturaProposta ? new Date(data.dataAberturaProposta) : null,
            proposalCloseDate: data.dataEncerramentoProposta ? new Date(data.dataEncerramentoProposta) : null,
            linkOrigem: data.linkSistemaOrigem ?? null,
            linkProcesso: data.linkProcessoEletronico ?? null,
            budgetSources: data.fontesOrcamentarias?.length
              ? (data.fontesOrcamentarias as unknown as Prisma.InputJsonValue)
              : undefined,
            state: data.unidadeOrgao?.ufSigla ?? null,
            city: data.unidadeOrgao?.municipioNome ?? null,
            rawRecordId: raw.id,
          },
          update: {
            orgName: data.orgaoEntidade.razaoSocial,
            status: data.situacaoCompraNome,
            statusId: data.situacaoCompraId,
            estimatedValue: data.valorTotalEstimado != null ? data.valorTotalEstimado : undefined,
            approvedValue: data.valorTotalHomologado != null ? data.valorTotalHomologado : undefined,
            totalValue: data.valorTotalHomologado ?? data.valorTotalEstimado ?? undefined,
            state: data.unidadeOrgao?.ufSigla ?? null,
            city: data.unidadeOrgao?.municipioNome ?? null,
            legalBasis: data.amparoLegal?.nome ?? null,
            legalBasisDescription: data.amparoLegal?.descricao ?? null,
          },
        });

        await prisma.rawRecord.update({
          where: { id: raw.id },
          data: { processedAt: new Date() },
        });

        recordsOut++;
      } catch (error) {
        console.error(
          `[process-procurements] Error processing ${raw.externalId}:`,
          error
        );
        await prisma.rawRecord.update({
          where: { id: raw.id },
          data: {
            processingError:
              error instanceof Error ? error.message : "Unknown error",
          },
        });
      }
    }

    return { recordsIn: unprocessed.length, recordsOut };
  });
}
