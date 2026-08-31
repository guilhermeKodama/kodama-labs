"use client";

import { useEffect, useCallback } from "react";
import { useUser } from "@/lib/user-context";
import { useSettingsStore } from "@/lib/store/settings-store";
import { useBusinessStore } from "@/lib/store/business-store";
import { useTransactionStore } from "@/lib/store/transaction-store";
import { useTransferStore } from "@/lib/store/transfer-store";
import { useRecurringTransactionStore } from "@/lib/store/recurring-store";
import { useRecurringTransferStore } from "@/lib/store/recurring-transfer-store";
import { useBudgetStore } from "@/lib/store/budget-store";
import { refreshAllData } from "@/lib/refresh-data";

export function useInitializeData() {
  const { userId, isLoading: isUserLoading } = useUser();

  const settingsLoading = useSettingsStore((s) => s.isLoading);
  const businessLoading = useBusinessStore((s) => s.isLoading);
  const transactionLoading = useTransactionStore((s) => s.isLoading);
  const transferLoading = useTransferStore((s) => s.isLoading);
  const recurringLoading = useRecurringTransactionStore((s) => s.isLoading);
  const recurringTransferLoading = useRecurringTransferStore((s) => s.isLoading);
  const budgetLoading = useBudgetStore((s) => s.isLoading);
  
  const isInitialized = useSettingsStore((s) => s.isInitialized);

  const initializeAllData = useCallback(async () => {
    if (!userId) return;
    await refreshAllData({ force: true });
  }, [userId]);

  useEffect(() => {
    if (userId && !isInitialized) {
      initializeAllData();
    }
  }, [userId, isInitialized, initializeAllData]);

  const isLoading =
    isUserLoading ||
    settingsLoading ||
    businessLoading ||
    transactionLoading ||
    transferLoading ||
    recurringLoading ||
    recurringTransferLoading ||
    budgetLoading;

  return {
    isLoading,
    isInitialized,
    refetch: initializeAllData,
  };
}
