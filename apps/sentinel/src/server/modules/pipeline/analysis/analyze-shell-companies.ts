import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { differenceInMonths } from "date-fns";

const BATCH_SIZE = 100;
const MIN_MONTHS_BEFORE_CONTRACT = 6;
const CAPITAL_TO_CONTRACT_RATIO = 0.01; // Capital < 1% of contract value

export async function analyzeShellCompanies() {
  return runJob("analyze-shell-companies", "analysis", async () => {
    const entities = await prisma.entity.findMany({
      where: {
        enrichedAt: { not: null },
        isShellCompany: false,
      },
      include: {
        contracts: {
          orderBy: { startDate: "asc" },
          take: 1,
          select: { startDate: true, value: true },
        },
        shareholders: true,
        _count: { select: { contracts: true } },
      },
      take: BATCH_SIZE,
    });

    let recordsOut = 0;

    for (const entity of entities) {
      const flags: string[] = [];
      const details: Record<string, unknown> = {};

      if (entity.openDate && entity.contracts.length > 0) {
        const firstContract = entity.contracts[0]!;
        const monthsBefore = differenceInMonths(
          firstContract.startDate,
          entity.openDate
        );

        if (monthsBefore < MIN_MONTHS_BEFORE_CONTRACT) {
          flags.push("recently_created");
          details.monthsBeforeFirstContract = monthsBefore;
        }
      }

      if (entity.capital && entity.contracts.length > 0) {
        const maxContractValue = Number(entity.contracts[0]!.value);
        const capitalValue = Number(entity.capital);

        if (
          capitalValue > 0 &&
          maxContractValue > 0 &&
          capitalValue / maxContractValue < CAPITAL_TO_CONTRACT_RATIO
        ) {
          flags.push("low_capital");
          details.capitalToContractRatio = capitalValue / maxContractValue;
        }
      }

      if (entity.shareholders.length <= 1) {
        flags.push("single_shareholder");
      }

      if (flags.length >= 2) {
        await prisma.entity.update({
          where: { id: entity.id },
          data: { isShellCompany: true },
        });

        await prisma.alert.create({
          data: {
            type: "SHELL_COMPANY",
            severity: flags.length >= 3 ? "HIGH" : "MEDIUM",
            title: `Possível empresa de fachada: ${entity.name}`,
            description: `Entidade ${entity.name} (${entity.cnpj}) apresenta ${flags.length} indicadores de empresa de fachada: ${flags.join(", ")}.`,
            entityId: entity.id,
            data: { flags, ...details, entityCnpj: entity.cnpj },
          },
        });

        recordsOut++;
      }
    }

    return { recordsIn: entities.length, recordsOut };
  });
}
