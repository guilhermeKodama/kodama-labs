import { prisma } from "@sentinel/server/lib/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import type { PncpContract } from "@/lib/gov-apis/pncp";
import type { TransparenciaContrato } from "@/lib/gov-apis/transparencia";

const BATCH_SIZE = 1000;

export async function processContracts() {
  return runJob("process-contracts", "processing", async () => {
    const unprocessed = await prisma.rawRecord.findMany({
      where: {
        recordType: { in: ["contract", "contrato"] },
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, source: true, recordType: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!unprocessed.length) return { recordsIn: 0, recordsOut: 0 };

    const successIds: string[] = [];
    const errors: { id: string; error: string }[] = [];

    const allSupplierCnpjs = new Set<string>();
    const entityUpserts: { cnpj: string; name: string; state: string | null }[] = [];

    for (const raw of unprocessed) {
      const data = raw.data as unknown as PncpContract & TransparenciaContrato;
      let cnpj: string;
      let name: string;
      let state: string | null = null;

      if (raw.recordType === "contrato") {
        cnpj = (data.fornecedor?.cnpjFormatado ?? "").replace(/\D/g, "");
        name = data.fornecedor?.nome ?? "Desconhecido";
      } else {
        cnpj = (data.niFornecedor ?? "").replace(/\D/g, "");
        name = data.nomeRazaoSocialFornecedor ?? "Desconhecido";
        state = data.unidadeOrgao?.ufSigla ?? null;
      }

      if (cnpj && !allSupplierCnpjs.has(cnpj)) {
        allSupplierCnpjs.add(cnpj);
        entityUpserts.push({ cnpj, name, state });
      }
    }

    if (entityUpserts.length > 0) {
      for (const e of entityUpserts) {
        try {
          await prisma.entity.upsert({
            where: { cnpj: e.cnpj },
            create: { cnpj: e.cnpj, name: e.name, state: e.state },
            update: {},
          });
        } catch {
          // entity may already exist, safe to ignore
        }
      }
    }

    const procurementExtIds = unprocessed
      .filter((r) => r.recordType === "contract")
      .map((r) => (r.data as unknown as PncpContract).numeroControlePncpCompra)
      .filter(Boolean) as string[];

    const procurementMap = new Map<string, string>();
    if (procurementExtIds.length > 0) {
      const CHUNK = 500;
      for (let i = 0; i < procurementExtIds.length; i += CHUNK) {
        const procs = await prisma.procurement.findMany({
          where: { externalId: { in: procurementExtIds.slice(i, i + CHUNK) } },
          select: { id: true, externalId: true },
        });
        for (const p of procs) procurementMap.set(p.externalId, p.id);
      }
    }

    for (const raw of unprocessed) {
      try {
        if (raw.recordType === "contrato") {
          await processTransparenciaContrato(raw as { id: string; externalId: string; data: unknown });
          successIds.push(raw.id);
          continue;
        }

        const data = raw.data as unknown as PncpContract;
        const supplierCnpj = (data.niFornecedor ?? "").replace(/\D/g, "");
        if (!supplierCnpj) {
          successIds.push(raw.id);
          continue;
        }

        const procurementId = data.numeroControlePncpCompra
          ? procurementMap.get(data.numeroControlePncpCompra) ?? null
          : null;

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
            year: data.anoContrato ?? null,
            sequencial: data.sequencialContrato ?? null,
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
            year: data.anoContrato ?? undefined,
            sequencial: data.sequencialContrato ?? undefined,
            description,
          },
        });

        successIds.push(raw.id);
      } catch (error) {
        errors.push({
          id: raw.id,
          error: error instanceof Error ? error.message : "Unknown error",
        });
      }
    }

    await markProcessed(successIds);
    await markErrors(errors);

    return { recordsIn: unprocessed.length, recordsOut: successIds.length };
  });
}

async function processTransparenciaContrato(raw: { id: string; externalId: string; data: unknown }) {
  const data = raw.data as unknown as TransparenciaContrato;

  const supplierCnpj = (data.fornecedor?.cnpjFormatado ?? "").replace(/\D/g, "");
  if (!supplierCnpj) return;

  const orgCnpj = (data.orgaoEntidade?.cnpj ?? "").replace(/\D/g, "");
  const startDate = data.dataInicioVigencia ? new Date(data.dataInicioVigencia) : new Date();
  const contractValue = data.valorInicial ?? 0;

  await prisma.contract.upsert({
    where: { externalId: raw.externalId },
    create: {
      externalId: raw.externalId,
      orgCnpj: orgCnpj || null,
      orgName: data.orgaoEntidade?.razaoSocial ?? null,
      supplierCnpj,
      supplierName: data.fornecedor?.nome ?? "Desconhecido",
      objectDescription: data.objeto ?? null,
      value: contractValue,
      initialValue: data.valorInicial ?? null,
      startDate,
      endDate: data.dataFimVigencia ? new Date(data.dataFimVigencia) : null,
      description: data.objeto ?? `Contrato Transparência ${data.id}`,
      rawRecordId: raw.id,
    },
    update: {
      supplierName: data.fornecedor?.nome ?? undefined,
      objectDescription: data.objeto ?? undefined,
      value: contractValue,
      endDate: data.dataFimVigencia ? new Date(data.dataFimVigencia) : undefined,
    },
  });
}
