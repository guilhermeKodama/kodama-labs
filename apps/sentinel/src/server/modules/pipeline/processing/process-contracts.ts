import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import type { PncpContract } from "@/lib/gov-apis/pncp";

const BATCH_SIZE = 100;

export async function processContracts() {
  return runJob("process-contracts", "processing", async () => {
    const unprocessed = await prisma.rawRecord.findMany({
      where: {
        recordType: "contract",
        processedAt: null,
        processingError: null,
      },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    let recordsOut = 0;

    for (const raw of unprocessed) {
      try {
        const data = raw.data as unknown as PncpContract;
        const supplierCnpj = (data.niFornecedor ?? "").replace(/\D/g, "");

        if (!supplierCnpj) {
          await prisma.rawRecord.update({
            where: { id: raw.id },
            data: { processedAt: new Date() },
          });
          continue;
        }

        await prisma.entity.upsert({
          where: { cnpj: supplierCnpj },
          create: {
            cnpj: supplierCnpj,
            name: data.nomeRazaoSocialFornecedor ?? "Desconhecido",
            state: data.unidadeOrgao?.ufSigla ?? null,
          },
          update: {},
        });

        let procurementId: string | null = null;
        if (data.numeroControlePncpCompra) {
          const procurement = await prisma.procurement.findUnique({
            where: { externalId: data.numeroControlePncpCompra },
            select: { id: true },
          });
          procurementId = procurement?.id ?? null;
        }

        const contractValue = data.valorInicial ?? data.valorGlobal ?? 0;

        const description =
          data.objetoContrato ??
          data.categoriaProcesso?.nome ??
          data.informacaoComplementar ??
          `Contrato ${data.numeroContratoEmpenho}`;

        await prisma.contract.upsert({
          where: { externalId: raw.externalId },
          create: {
            externalId: raw.externalId,
            procurementId,
            procurementExternalId: data.numeroControlePncpCompra ?? null,

            orgCnpj: data.orgaoEntidade?.cnpj ?? null,
            orgName: data.orgaoEntidade?.razaoSocial ?? null,
            unitName: data.unidadeOrgao?.nomeUnidade ?? null,
            unitState: data.unidadeOrgao?.ufSigla ?? null,
            unitCity: data.unidadeOrgao?.municipioNome ?? null,

            supplierCnpj,
            supplierName: data.nomeRazaoSocialFornecedor ?? "Desconhecido",
            supplierType: data.tipoPessoa ?? null,
            supplierCountry: data.codigoPaisFornecedor ?? null,

            objectDescription: data.objetoContrato ?? null,
            categoryName: data.categoriaProcesso?.nome ?? null,
            categoryId: data.categoriaProcesso?.id ?? null,
            contractType: data.tipoContrato?.nome ?? null,
            contractTypeId: data.tipoContrato?.id ?? null,
            processo: data.processo ?? null,
            contractNumber: data.numeroContratoEmpenho ?? null,

            value: contractValue,
            initialValue: data.valorInicial ?? null,
            globalValue: data.valorGlobal ?? null,
            installmentValue: data.valorParcela ?? null,
            installmentCount: data.numeroParcelas ?? null,
            accumulatedValue: data.valorAcumulado ?? null,

            signatureDate: data.dataAssinatura ? new Date(data.dataAssinatura) : null,
            startDate: new Date(data.dataVigenciaInicio),
            endDate: data.dataVigenciaFim ? new Date(data.dataVigenciaFim) : null,
            publishedAt: data.dataPublicacaoPncp ? new Date(data.dataPublicacaoPncp) : null,

            amendmentCount: data.numeroRetificacao ?? 0,
            isRevenue: data.receita ?? false,

            subcontractorCnpj: data.niFornecedorSubContratado
              ? data.niFornecedorSubContratado.replace(/\D/g, "")
              : null,
            subcontractorName: data.nomeFornecedorSubContratado ?? null,

            description,
            rawRecordId: raw.id,
          },
          update: {
            supplierName: data.nomeRazaoSocialFornecedor ?? "Desconhecido",
            supplierType: data.tipoPessoa ?? null,
            objectDescription: data.objetoContrato ?? null,
            value: contractValue,
            initialValue: data.valorInicial ?? null,
            globalValue: data.valorGlobal ?? null,
            installmentValue: data.valorParcela ?? null,
            accumulatedValue: data.valorAcumulado ?? null,
            endDate: data.dataVigenciaFim ? new Date(data.dataVigenciaFim) : null,
            amendmentCount: data.numeroRetificacao ?? 0,
            description,
          },
        });

        await prisma.rawRecord.update({
          where: { id: raw.id },
          data: { processedAt: new Date() },
        });

        recordsOut++;
      } catch (error) {
        console.error(
          `[process-contracts] Error processing ${raw.externalId}:`,
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
