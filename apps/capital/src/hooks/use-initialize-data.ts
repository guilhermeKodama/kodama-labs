"use client";

import { useEffect, useCallback } from "react";
import { useUser } from "@/lib/user-context";
import { useSettingsStore } from "@/lib/store/settings-store";
import { useBusinessStore } from "@/lib/store/business-store";
import { useTransactionStore } from "@/lib/store/transaction-store";
import { useTransferStore } from "@/lib/store/transfer-store";
import { useRecurringTransactionStore } from "@/lib/store/recurring-store";
import { useBudgetStore } from "@/lib/store/budget-store";

export function useInitializeData() {
  const { userId, isLoading: isUserLoading } = useUser();
  
  const fetchUserData = useSettingsStore((s) => s.fetchUserData);
  const fetchBusinesses = useBusinessStore((s) => s.fetchBusinesses);
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);
  const fetchTransfers = useTransferStore((s) => s.fetchTransfers);
  const fetchRecurringTransactions = useRecurringTransactionStore((s) => s.fetchRecurringTransactions);
  const fetchBudgets = useBudgetStore((s) => s.fetchBudgets);
  
  const settingsLoading = useSettingsStore((s) => s.isLoading);
  const businessLoading = useBusinessStore((s) => s.isLoading);
  const transactionLoading = useTransactionStore((s) => s.isLoading);
  const transferLoading = useTransferStore((s) => s.isLoading);
  const recurringLoading = useRecurringTransactionStore((s) => s.isLoading);
  const budgetLoading = useBudgetStore((s) => s.isLoading);
  
  const isInitialized = useSettingsStore((s) => s.isInitialized);

  const initializeAllData = useCallback(async () => {
    if (!userId) return;

    // Fetch settings first (includes currencies and categories)
    await fetchUserData(userId);

    // Then fetch all other data in parallel
    await Promise.all([
      fetchBusinesses(userId),
      fetchTransactions(),
      fetchTransfers(),
      fetchRecurringTransactions(),
      fetchBudgets(),
    ]);
  }, [
    userId,
    fetchUserData,
    fetchBusinesses,
    fetchTransactions,
    fetchTransfers,
    fetchRecurringTransactions,
    fetchBudgets,
  ]);

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
    budgetLoading;

  return {
    isLoading,
    isInitialized,
    refetch: initializeAllData,
  };
}
