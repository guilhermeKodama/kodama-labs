import { prisma } from "@sentinel/server/lib/prisma";
import { runJob } from "@sentinel/server/lib/job-runner";
import { differenceInMonths } from "date-fns";
import {
  buildAlertI18n,
  renderCodeListPtBr,
  renderPtBr,
} from "@sentinel/server/lib/alert-i18n";

const MIN_MONTHS_BEFORE_CONTRACT = 6;
const CAPITAL_TO_CONTRACT_RATIO = 0.01;

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

        const i18nParams = {
          entityName: entity.name,
          cnpj: entity.cnpj,
          flagCount: flags.length,
          flags: flags.join(","),
        };
        const fallbackParams = {
          ...i18nParams,
          flags: renderCodeListPtBr("shellCompanyFlag", flags),
        };
        const i18n = buildAlertI18n(
          "alerts.templates.shellCompany.title",
          "alerts.templates.shellCompany.description",
          i18nParams,
        );

        await prisma.alert.create({
          data: {
            type: "SHELL_COMPANY",
            severity: flags.length >= 3 ? "HIGH" : "MEDIUM",
            title: renderPtBr("alerts.templates.shellCompany.title", fallbackParams),
            description: renderPtBr("alerts.templates.shellCompany.description", fallbackParams),
            entityId: entity.id,
            data: { flags, ...details, entityCnpj: entity.cnpj, i18n },
          },
        });

        recordsOut++;
      }
    }

    return { recordsIn: entities.length, recordsOut };
  });
}
