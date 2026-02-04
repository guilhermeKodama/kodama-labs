import type { DbClient } from "@capital/server/lib/prisma";

export interface TaxSummary {
  entityId: string;
  entityName: string;
  totalIncome: number;
  totalDeductible: number;
  taxableIncome: number;
  estimatedTax: number;
  taxRate: number;
}

interface GetTaxReportInput {
  userId: string;
  year: number;
}

export async function getTaxReport(
  input: GetTaxReportInput,
  db: DbClient
): Promise<TaxSummary[]> {
  const { userId, year } = input;

  const startDate = new Date(year, 0, 1);
  const endDate = new Date(year, 11, 31);

  // Get user's businesses
  const businesses = await db.business.findMany({
    where: { userId },
  });

  const summaries: TaxSummary[] = [];

  for (const business of businesses) {
    const transactions = await db.transaction.findMany({
      where: {
        businessId: business.id,
        date: {
          gte: startDate,
          lte: endDate,
        },
      },
    });

    const totalIncome = transactions
      .filter((t) => t.type === "income")
      .reduce((sum, t) => sum + t.amount, 0);

    const totalDeductible = transactions
      .filter((t) => t.type === "expense" && t.isTaxDeductible)
      .reduce((sum, t) => sum + t.amount, 0);

    const taxableIncome = totalIncome - totalDeductible;
    const taxRate = business.taxRate;
    const estimatedTax = (taxableIncome * taxRate) / 100;

    summaries.push({
      entityId: business.id,
      entityName: business.name,
      totalIncome,
      totalDeductible,
      taxableIncome,
      estimatedTax: Math.max(0, estimatedTax),
      taxRate,
    });
  }

  return summaries;
}
