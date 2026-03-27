import { prisma } from "@sentinel/server/lib/prisma";
import { runJob, markProcessed, markErrors } from "@sentinel/server/lib/job-runner";
import type { CnpjData } from "@/lib/gov-apis/cnpj";
import type { ComprasGovFornecedor } from "@/lib/gov-apis/compras-gov";

const BATCH_SIZE = 50;

export async function processEntities() {
  return runJob("process-entities", "processing", async () => {
    const unprocessed = await prisma.rawRecord.findMany({
      where: {
        recordType: { in: ["entity", "fornecedor"] },
        processedAt: null,
        processingError: null,
      },
      select: { id: true, externalId: true, recordType: true, data: true },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    if (!unprocessed.length) return { recordsIn: 0, recordsOut: 0 };

    const successIds: string[] = [];
    const errors: { id: string; error: string }[] = [];

    for (const raw of unprocessed) {
      try {
        if (raw.recordType === "fornecedor") {
          await processFornecedor(raw as { id: string; externalId: string; data: unknown });
          successIds.push(raw.id);
          continue;
        }

        const data = raw.data as unknown as CnpjData;
        const cnpj = data.cnpj.replace(/\D/g, "");

        await prisma.entity.upsert({
          where: { cnpj },
          create: {
            cnpj,
            name: data.razao_social,
            tradeName: data.nome_fantasia,
            legalNature: data.natureza_juridica,
            openDate: data.data_inicio_atividade
              ? new Date(data.data_inicio_atividade)
              : null,
            capital: data.capital_social,
            activityCode: data.cnae_fiscal.toString(),
            activityDesc: data.cnae_fiscal_descricao,
            address: [data.logradouro, data.numero, data.complemento, data.bairro]
              .filter(Boolean)
              .join(", "),
            state: data.uf,
            city: data.municipio,
            enrichedAt: new Date(),
            rawRecordId: raw.id,
          },
          update: {
            name: data.razao_social,
            tradeName: data.nome_fantasia,
            legalNature: data.natureza_juridica,
            openDate: data.data_inicio_atividade
              ? new Date(data.data_inicio_atividade)
              : undefined,
            capital: data.capital_social,
            activityCode: data.cnae_fiscal.toString(),
            activityDesc: data.cnae_fiscal_descricao,
            address: [data.logradouro, data.numero, data.complemento, data.bairro]
              .filter(Boolean)
              .join(", "),
            state: data.uf,
            city: data.municipio,
            enrichedAt: new Date(),
          },
        });

        if (data.qsa && data.qsa.length > 0) {
          const entity = await prisma.entity.findUnique({
            where: { cnpj },
            select: { id: true },
          });

          if (entity) {
            await prisma.shareholder.deleteMany({
              where: { entityId: entity.id },
            });

            await prisma.shareholder.createMany({
              data: data.qsa.map((s) => ({
                entityId: entity.id,
                name: s.nome_socio,
                cpfCnpj: s.cnpj_cpf_do_socio || null,
                role: s.qualificacao_socio,
              })),
            });
          }
        }

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

async function processFornecedor(raw: { id: string; externalId: string; data: unknown }) {
  const data = raw.data as unknown as ComprasGovFornecedor;
  const cnpj = (data.cnpj ?? "").replace(/\D/g, "");
  if (!cnpj) return;

  await prisma.entity.upsert({
    where: { cnpj },
    create: {
      cnpj,
      name: data.nome ?? "Desconhecido",
      rawRecordId: raw.id,
    },
    update: {
      name: data.nome || undefined,
    },
  });
}
