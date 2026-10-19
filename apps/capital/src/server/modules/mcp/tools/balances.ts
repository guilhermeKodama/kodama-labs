import type { DbClient } from "@capital/server/lib/prisma";
import { formatDateOnly, parseLocalDate } from "@capital/server/lib/date-utils";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round, toNumber } from "@capital/server/modules/ledger/lib/money";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";

const CASH_TYPES = ["checking", "cash", "brokerage"] as const;

export interface ListAccountBalancesInput {
  /** Calendar day (YYYY-MM-DD). Entries after that day are left out. */
  asOf?: string;
}

/** End of the calendar day `value` names, so a noon-UTC entry on that day counts. */
function inclusiveDayEnd(value: string): Date {
  const day = formatDateOnly(parseLocalDate(value));
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, 23, 59, 59, 999));
}

/**
 * Checking, cash and brokerage balances. Native `balance` is accountBalances
 * (the accounts screen). `balanceBase` uses today's rate, the same conversion
 * the portfolio uses for broker cash; with `asOf`, the rate of that date.
 * Credit cards are left out.
 */
export async function listAccountBalances(userId: string, params: ListAccountBalancesInput, db: DbClient) {
  const asOf = params.asOf ? inclusiveDayEnd(params.asOf) : undefined;
  const accounts = await db.account.findMany({
    where: { userId, archivedAt: null, type: { in: [...CASH_TYPES] } },
    include: { entity: { select: { id: true, name: true, kind: true } } },
    orderBy: [{ entityId: "asc" }, { isDefault: "desc" }, { name: "asc" }],
  });
  const [balances, fx] = await Promise.all([
    accounts.length ? accountBalances(userId, db, accounts.map((account) => account.id), asOf) : Promise.resolve(new Map<string, number>()),
    loadFx(userId, db),
  ]);
  return {
    baseCurrency: fx.baseCurrency,
    asOf: params.asOf ? formatDateOnly(parseLocalDate(params.asOf)) : null,
    accounts: accounts.map((account) => {
      const balance = balances.get(account.id) ?? toNumber(account.initialBalance);
      const rate = asOf ? fx.rateOn(account.currency, asOf) : fx.rateFor(account.currency);
      return {
        id: account.id,
        name: account.name,
        type: account.type,
        entity: account.entity.kind === "business" ? "PJ" : "PF",
        entityId: account.entity.id,
        entityName: account.entity.name,
        currency: account.currency,
        balance,
        balanceBase: round(balance * rate, 2),
      };
    }),
  };
}
