import type { AccountType, LedgerEntry, TransferDirection } from "@/generated/prisma";
import { formatDateOnly } from "@capital/server/lib/date-utils";
import type { LedgerRow } from "../contracts";
import { toNumber, type DecimalLike } from "./money";

export type EntryWithContext = LedgerEntry & {
  account: { type: AccountType };
  transferGroup?: { direction: TransferDirection; legs?: { id: string; accountId: string; amount: DecimalLike; currency: string }[] } | null;
};

export function serializeEntry(entry: EntryWithContext): LedgerRow {
  const counterpart = entry.transferGroup?.legs?.find((l) => l.id !== entry.id) ?? null;
  return {
    id: entry.id,
    date: formatDateOnly(entry.date),
    effectiveDate: formatDateOnly(entry.effectiveDate),
    description: entry.description,
    notes: entry.notes,
    kind: entry.kind,
    amount: toNumber(entry.amount),
    currency: entry.currency,
    exchangeRate: toNumber(entry.exchangeRate),
    amountBase: toNumber(entry.amountBase),
    entityId: entry.entityId,
    accountId: entry.accountId,
    accountType: entry.account.type,
    categoryId: entry.categoryId,
    isTaxDeductible: entry.isTaxDeductible,
    isRecurring: entry.recurringRuleId !== null,
    transferGroupId: entry.transferGroupId,
    transferDirection: entry.transferGroup?.direction ?? null,
    counterpartAccountId: counterpart?.accountId ?? null,
    counterpartAmount: counterpart ? toNumber(counterpart.amount) : null,
    counterpartCurrency: counterpart?.currency ?? null,
    cardStatementId: entry.cardStatementId,
    installmentPlanId: entry.installmentPlanId,
    installmentNumber: entry.installmentNumber,
    recurringRuleId: entry.recurringRuleId,
    importId: entry.importId,
    deletedAt: entry.deletedAt?.toISOString() ?? null,
  };
}

export const ENTRY_CONTEXT_INCLUDE = {
  account: { select: { type: true } },
  transferGroup: { select: { direction: true, legs: { select: { id: true, accountId: true, amount: true, currency: true } } } },
} as const;
