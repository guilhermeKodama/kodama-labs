import type { Prisma } from "@/generated/prisma";

function utcYYYYMM(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}`;
}

/**
 * Statements whose effective date falls in [start, end].
 * Effective date is closingDate, or the statement month when closingDate is null.
 */
export function statementInWindow(
  start?: Date,
  end?: Date
): Prisma.CreditCardStatementWhereInput {
  if (!start && !end) return {};
  return {
    OR: [
      {
        closingDate: {
          ...(start ? { gte: start } : {}),
          ...(end ? { lte: end } : {}),
        },
      },
      {
        closingDate: null,
        month: {
          ...(start ? { gte: utcYYYYMM(start) } : {}),
          ...(end ? { lte: utcYYYYMM(end) } : {}),
        },
      },
    ],
  };
}
