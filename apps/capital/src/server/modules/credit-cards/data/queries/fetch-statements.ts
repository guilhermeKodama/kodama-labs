import type { DbClient } from "@capital/server/lib/prisma";
import { parseLocalDate } from "@capital/server/lib/date-utils";
import { statementInWindow } from "../../lib/statement-window";

function monthEnd(yearMonth: string): Date {
  const [year, month] = yearMonth.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return parseLocalDate(
    `${yearMonth}-${String(lastDay).padStart(2, "0")}`
  );
}

/**
 * Statements the user owns, with purchases. Optional YYYY-MM bounds
 * filter by the statement's effective date (closing date, else month).
 */
export async function fetchStatements(
  userId: string,
  db: DbClient,
  range?: { from?: string; to?: string }
) {
  const start = range?.from ? parseLocalDate(`${range.from}-01`) : undefined;
  const end = range?.to ? monthEnd(range.to) : undefined;

  return db.creditCardStatement.findMany({
    where: {
      creditCard: {
        OR: [{ business: { userId } }, { personalAccount: { userId } }],
      },
      ...statementInWindow(start, end),
    },
    include: {
      creditCard: {
        select: {
          id: true,
          entityType: true,
          businessId: true,
          personalAccountId: true,
          currency: true,
        },
      },
      purchases: {
        select: {
          id: true,
          amount: true,
          currency: true,
          category: true,
          description: true,
          transactionDate: true,
        },
        orderBy: { transactionDate: "asc" },
      },
    },
    orderBy: { month: "desc" },
  });
}
