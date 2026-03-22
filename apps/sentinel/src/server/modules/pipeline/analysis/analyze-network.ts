import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";

export async function analyzeNetwork() {
  return runJob("analyze-network", "analysis", async () => {
    const shareholders = await prisma.shareholder.findMany({
      where: { cpfCnpj: { not: null } },
      select: {
        cpfCnpj: true,
        name: true,
        entityId: true,
        entity: { select: { cnpj: true, name: true } },
      },
    });

    const shareholderToEntities = new Map<string, { entityId: string; entityCnpj: string; entityName: string }[]>();

    for (const s of shareholders) {
      if (!s.cpfCnpj) continue;
      const key = s.cpfCnpj;
      const existing = shareholderToEntities.get(key) ?? [];
      existing.push({
        entityId: s.entityId,
        entityCnpj: s.entity.cnpj,
        entityName: s.entity.name,
      });
      shareholderToEntities.set(key, existing);
    }

    let recordsOut = 0;

    for (const [shareholderCpf, entities] of shareholderToEntities) {
      if (entities.length < 2) continue;

      const entityIds = entities.map((e) => e.entityId);

      const procurements = await prisma.procurement.findMany({
        where: {
          contracts: {
            some: {
              supplierCnpj: { in: entities.map((e) => e.entityCnpj) },
            },
          },
        },
        select: {
          id: true,
          description: true,
          orgName: true,
          contracts: {
            where: {
              supplierCnpj: { in: entities.map((e) => e.entityCnpj) },
            },
            select: { supplierCnpj: true, supplierName: true },
          },
        },
      });

      for (const proc of procurements) {
        const suppliersInProc = proc.contracts.map((c) => c.supplierCnpj);
        const overlapping = entities.filter((e) =>
          suppliersInProc.includes(e.entityCnpj)
        );

        if (overlapping.length < 2) continue;

        const existingAlert = await prisma.alert.findFirst({
          where: {
            type: "SUSPICIOUS_NETWORK",
            procurementId: proc.id,
            data: {
              path: ["shareholderCpf"],
              equals: shareholderCpf,
            },
          },
        });

        if (existingAlert) continue;

        await prisma.alert.create({
          data: {
            type: "SUSPICIOUS_NETWORK",
            severity: "HIGH",
            title: `Sócio em comum entre fornecedores na mesma licitação`,
            description: `As empresas ${overlapping.map((e) => e.entityName).join(" e ")} compartilham o mesmo sócio (CPF: ${shareholderCpf}) e participaram da mesma licitação "${proc.description}" do órgão ${proc.orgName}. Possível conluio.`,
            procurementId: proc.id,
            entityId: overlapping[0]?.entityId,
            data: {
              shareholderCpf,
              entities: overlapping.map((e) => ({
                cnpj: e.entityCnpj,
                name: e.entityName,
              })),
              procurementDescription: proc.description,
            },
          },
        });

        recordsOut++;
      }
    }

    return { recordsIn: shareholders.length, recordsOut };
  });
}
