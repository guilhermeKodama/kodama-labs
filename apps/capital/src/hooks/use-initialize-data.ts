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
import { useCreditCardStore } from "@/lib/store/credit-card-store";
import { useInvestmentStore } from "@/lib/store/investment-store";

export function useInitializeData() {
  const { userId, isLoading: isUserLoading } = useUser();
  
  const fetchUserData = useSettingsStore((s) => s.fetchUserData);
  const fetchBusinesses = useBusinessStore((s) => s.fetchBusinesses);
  const fetchTransactions = useTransactionStore((s) => s.fetchTransactions);
  const fetchTransfers = useTransferStore((s) => s.fetchTransfers);
  const fetchRecurringTransactions = useRecurringTransactionStore((s) => s.fetchRecurringTransactions);
  const fetchRecurringTransfers = useRecurringTransferStore((s) => s.fetchRecurringTransfers);
  const fetchBudgets = useBudgetStore((s) => s.fetchBudgets);
  const fetchCreditCards = useCreditCardStore((s) => s.fetchCreditCards);
  const fetchBills = useCreditCardStore((s) => s.fetchBills);
  const fetchInstallments = useCreditCardStore((s) => s.fetchInstallments);
  const fetchInvestmentAccounts = useInvestmentStore((s) => s.fetchAccounts);
  const fetchInvestmentHoldings = useInvestmentStore((s) => s.fetchHoldings);
  const fetchInvestmentTransactions = useInvestmentStore((s) => s.fetchTransactions);
  
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

    // Fetch settings first (includes currencies and categories)
    // userId is now taken from session on the backend
    await fetchUserData();

    // Then fetch all other data in parallel
    // userId is now taken from session on the backend
    await Promise.all([
      fetchBusinesses(),
      fetchTransactions(),
      fetchTransfers(),
      fetchRecurringTransactions(),
      fetchRecurringTransfers(),
      fetchBudgets(),
      fetchCreditCards(),
      fetchBills(),
      fetchInstallments(),
      fetchInvestmentAccounts(),
      fetchInvestmentHoldings(),
      fetchInvestmentTransactions(),
    ]);
  }, [
    userId,
    fetchUserData,
    fetchBusinesses,
    fetchTransactions,
    fetchTransfers,
    fetchRecurringTransactions,
    fetchRecurringTransfers,
    fetchBudgets,
    fetchCreditCards,
    fetchBills,
    fetchInstallments,
    fetchInvestmentAccounts,
    fetchInvestmentHoldings,
    fetchInvestmentTransactions,
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
    recurringTransferLoading ||
    budgetLoading;

  return {
    isLoading,
    isInitialized,
    refetch: initializeAllData,
  };
}
