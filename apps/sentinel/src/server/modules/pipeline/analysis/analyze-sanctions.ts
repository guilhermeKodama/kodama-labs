import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { buildAlertI18n, renderPtBr } from "@sentinel/server/lib/alert-i18n";

export async function analyzeSanctions() {
  return runJob("analyze-sanctions", "analysis", async () => {
    const sanctionedCnpjs = await prisma.sanction.findMany({
      select: { cnpjCpf: true, source: true, reason: true, type: true },
      distinct: ["cnpjCpf"],
    });

    const sanctionMap = new Map<
      string,
      { source: string; reason: string; type: string }[]
    >();
    for (const s of sanctionedCnpjs) {
      const existing = sanctionMap.get(s.cnpjCpf) ?? [];
      existing.push({ source: s.source, reason: s.reason, type: s.type });
      sanctionMap.set(s.cnpjCpf, existing);
    }

    if (sanctionMap.size === 0) {
      return { recordsIn: 0, recordsOut: 0 };
    }

    const contractsWithSanctioned = await prisma.contract.findMany({
      where: {
        supplierCnpj: { in: Array.from(sanctionMap.keys()) },
      },
      include: {
        entity: { select: { id: true, name: true } },
        procurement: { select: { id: true, orgName: true } },
      },
    });

    let recordsOut = 0;
    const alertedCnpjs = new Set<string>();

    for (const contract of contractsWithSanctioned) {
      const sanctions = sanctionMap.get(contract.supplierCnpj);
      if (!sanctions) continue;
      if (alertedCnpjs.has(contract.supplierCnpj)) continue;
      alertedCnpjs.add(contract.supplierCnpj);

      const existing = await prisma.alert.findFirst({
        where: {
          type: "SANCTIONED_ENTITY",
          data: { path: ["supplierCnpj"], equals: contract.supplierCnpj },
        },
      });
      if (existing) continue;

      const contractCount = contractsWithSanctioned.filter(
        (c) => c.supplierCnpj === contract.supplierCnpj,
      ).length;

      const i18nParams = {
        supplierName: contract.supplierName,
        cnpj: contract.supplierCnpj,
        sources: sanctions.map((s) => s.source).join(", "),
        contractCount,
      };
      const i18n = buildAlertI18n(
        "alerts.templates.sanctionedEntity.title",
        "alerts.templates.sanctionedEntity.description",
        i18nParams,
      );

      await prisma.alert.create({
        data: {
          type: "SANCTIONED_ENTITY",
          severity: "CRITICAL",
          title: renderPtBr("alerts.templates.sanctionedEntity.title", i18nParams),
          description: renderPtBr("alerts.templates.sanctionedEntity.description", i18nParams),
          contractId: contract.id,
          entityId: contract.entity?.id ?? null,
          procurementId: contract.procurementId,
          data: {
            supplierCnpj: contract.supplierCnpj,
            contractCount,
            sanctions,
            i18n,
          },
        },
      });

      recordsOut++;
    }

    return {
      recordsIn: contractsWithSanctioned.length,
      recordsOut,
    };
  });
}
