import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import type { CnpjData } from "@/lib/gov-apis/cnpj";

const BATCH_SIZE = 50;

export async function processEntities() {
  return runJob("process-entities", "processing", async () => {
    const unprocessed = await prisma.rawRecord.findMany({
      where: {
        source: "CNPJ",
        recordType: "entity",
        processedAt: null,
        processingError: null,
      },
      take: BATCH_SIZE,
      orderBy: { fetchedAt: "asc" },
    });

    let recordsOut = 0;

    for (const raw of unprocessed) {
      try {
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

        await prisma.rawRecord.update({
          where: { id: raw.id },
          data: { processedAt: new Date() },
        });

        recordsOut++;
      } catch (error) {
        console.error(
          `[process-entities] Error processing ${raw.externalId}:`,
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
