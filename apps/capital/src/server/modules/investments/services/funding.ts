import type { DbClient } from "@capital/server/lib/prisma";
import type { Account } from "@/generated/prisma";
import type { FxContext } from "@capital/server/modules/ledger/lib/fx";
import { round } from "@capital/server/modules/ledger/lib/money";
import { getOwnedAccount } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { getDefaultAccount } from "@capital/server/modules/ledger/services/entities";
import { snapshot, type MutationRecordInput } from "@capital/server/modules/ledger/services/mutations";

/** `amount` in `from` converted to `to` at the user's current rates. */
export function convertAmount(amount: number, from: string, to: string, fx: FxContext) {
  return from === to ? amount : (amount * fx.rateFor(from)) / fx.rateFor(to);
}

/** The entity's main checking account; one created here joins the caller's batch (undo removes it with the rest). */
async function entityChecking(entityId: string, tx: DbClient, records: MutationRecordInput[]): Promise<Account> {
  const existing = await tx.account.findFirst({ where: { entityId, isDefault: true } });
  if (existing) return existing;
  const entity = await tx.entity.findUniqueOrThrow({ where: { id: entityId } });
  const created = await getDefaultAccount(entity, tx);
  records.push({ model: "Account", recordId: created.id, before: null, after: snapshot(created) });
  return created;
}

export interface FundBrokerInput {
  fromAccountId: string;
  broker: Account;
  /** Exactly what the broker receives, in its currency. */
  brokerAmount: number;
  /** What leaves the source, in its currency, when it differs from the broker's (default: converted at today's rate). */
  fundAmount?: number | null;
  date: string;
  /** Description of the investment deposit (default: the localized transfer description). */
  description?: string | null;
  importId?: string | null;
}

/**
 * Moves money from a checking or cash account into a broker, recording into
 * the caller's `records`. Within one entity it is one investment_deposit
 * transfer. Across entities the money first goes to the broker entity's
 * main checking account (a capital injection PF → PJ, a profit distribution
 * PJ → PF, or a transfer between businesses), then into the broker, so each
 * entity's books stay right. Across currencies each leg is in its account's
 * currency and the broker leg is exactly `brokerAmount`.
 */
export async function fundBroker(tx: DbClient, userId: string, input: FundBrokerInput, fx: FxContext, records: MutationRecordInput[]) {
  const from = await getOwnedAccount(userId, input.fromAccountId, tx);
  const { broker, brokerAmount } = input;
  const fromAmount = from.currency === broker.currency ? brokerAmount : input.fundAmount ?? convertAmount(brokerAmount, broker.currency, from.currency, fx);
  const transferGroupIds: string[] = [];

  let source = from;
  let sourceAmount = fromAmount;
  if (from.entityId !== broker.entityId) {
    const checking = await entityChecking(broker.entityId, tx, records);
    const checkingAmount =
      checking.currency === from.currency ? fromAmount : checking.currency === broker.currency ? brokerAmount : convertAmount(fromAmount, from.currency, checking.currency, fx);
    const between = await createEntry(
      userId,
      {
        kind: "transfer",
        fromAccountId: from.id,
        toAccountId: checking.id,
        amount: round(fromAmount, 4),
        ...(checking.currency !== from.currency && { currency: from.currency, toAmount: round(checkingAmount, 2) }),
        date: input.date,
      },
      tx,
      { importId: input.importId ?? null, collect: records }
    );
    transferGroupIds.push(between.transferGroupId!);
    source = checking;
    sourceAmount = checkingAmount;
  }

  const deposit = await createEntry(
    userId,
    {
      kind: "transfer",
      fromAccountId: source.id,
      toAccountId: broker.id,
      amount: round(sourceAmount, source.currency === broker.currency ? 4 : 2),
      ...(source.currency !== broker.currency && { currency: source.currency, toAmount: round(brokerAmount, 4) }),
      date: input.date,
      direction: "investment_deposit",
      ...(input.description && { description: input.description }),
    },
    tx,
    { importId: input.importId ?? null, collect: records }
  );
  transferGroupIds.push(deposit.transferGroupId!);
  return { depositGroupId: deposit.transferGroupId!, transferGroupIds };
}
