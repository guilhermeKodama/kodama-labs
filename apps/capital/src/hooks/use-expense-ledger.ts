"use client";

import { useMemo } from "react";
import { useTransactionStore } from "@/lib/store/transaction-store";
import { useCreditCardStore } from "@/lib/store/credit-card-store";
import { useSettingsStore } from "@/lib/store/settings-store";
import { buildExpenseLedger } from "@/lib/utils/expense-ledger";
import type { Transaction } from "@/types";

/** P&L transactions for the signed-in user. Cash views should not use this. */
export function useExpenseLedger(): Transaction[] {
  const { transactions } = useTransactionStore();
  const { statements } = useCreditCardStore();
  const { settings, currencies } = useSettingsStore();

  return useMemo(
    () =>
      buildExpenseLedger(
        transactions,
        statements,
        settings.baseCurrency,
        currencies
      ),
    [transactions, statements, settings.baseCurrency, currencies]
  );
}
