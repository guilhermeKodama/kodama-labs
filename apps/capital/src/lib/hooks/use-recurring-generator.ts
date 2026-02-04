'use client';

import { useEffect, useRef } from 'react';
import { useRecurringTransactionStore, useTransactionStore, useSettingsStore } from '@/lib/store';
import { generateDueTransactions } from '@/lib/utils/recurring';
import { toast } from 'sonner';

/**
 * Hook that automatically generates transactions from recurring transactions on app load
 */
export function useRecurringGenerator() {
  const { recurringTransactions, updateLastGeneratedDate } = useRecurringTransactionStore();
  const { addTransaction } = useTransactionStore();
  const { isInitialized } = useSettingsStore();
  const hasRun = useRef(false);

  useEffect(() => {
    // Only run once after app is initialized
    if (!isInitialized || hasRun.current) return;
    
    const activeRecurring = recurringTransactions.filter((rt) => rt.isActive);
    if (activeRecurring.length === 0) return;

    let generatedCount = 0;
    const now = new Date();

    activeRecurring.forEach((recurring) => {
      const dueTransactions = generateDueTransactions(recurring, now);
      
      if (dueTransactions.length > 0) {
        // Generate all due transactions
        dueTransactions.forEach((transactionInput) => {
          addTransaction(transactionInput);
          generatedCount++;
        });

        // Update the recurring transaction's last generated date
        const lastGeneratedDate = dueTransactions[dueTransactions.length - 1].date;
        updateLastGeneratedDate(recurring.id, lastGeneratedDate);
      }
    });

    if (generatedCount > 0) {
      toast.success(
        `Generated ${generatedCount} recurring transaction${generatedCount > 1 ? 's' : ''}`
      );
    }

    hasRun.current = true;
  }, [isInitialized, recurringTransactions, addTransaction, updateLastGeneratedDate]);
}
