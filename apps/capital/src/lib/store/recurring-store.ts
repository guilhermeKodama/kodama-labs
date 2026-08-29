import { create } from 'zustand';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';
import { parseLocalDate } from '@/lib/utils/date';
import type {
  RecurringTransaction,
  CreateRecurringTransactionInput,
  UpdateRecurringTransactionInput,
  EntityType,
  RecurrenceFrequency,
} from '@/types';
import { client } from '@/lib/api-client';

interface RecurringTransactionState {
  recurringTransactions: RecurringTransaction[];
  isLoading: boolean;
  error: string | null;
}

interface MarkAsPaidResult {
  transaction: {
    id: string;
    entityId: string;
    entityType: EntityType;
    type: 'income' | 'expense' | 'investment';
    amount: number;
    currency: string;
    exchangeRate: number;
    description: string;
    category: string;
    date: Date;
    isTaxDeductible: boolean;
    recurringTransactionId?: string;
    createdAt: Date;
    updatedAt: Date;
  };
  recurring: RecurringTransaction;
}

interface RecurringTransactionActions {
  fetchRecurringTransactions: (filters?: {
    businessId?: string;
    personalAccountId?: string;
    entityType?: EntityType;
    isActive?: boolean;
  }) => Promise<void>;
  addRecurringTransaction: (input: CreateRecurringTransactionInput) => Promise<RecurringTransaction | null>;
  updateRecurringTransaction: (id: string, input: UpdateRecurringTransactionInput) => Promise<void>;
  deleteRecurringTransaction: (id: string) => Promise<void>;
  toggleRecurringTransaction: (id: string) => Promise<void>;
  markAsPaid: (id: string) => Promise<MarkAsPaidResult | null>;
  updateLastGeneratedDate: (id: string, date: Date) => Promise<void>;
  getRecurringTransactionsByEntity: (entityId: string, entityType: EntityType) => RecurringTransaction[];
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type RecurringTransactionStore = RecurringTransactionState & RecurringTransactionActions;

/**
 * Calculate the next due date based on frequency
 */
export function calculateNextDueDate(
  currentDate: Date,
  frequency: RecurrenceFrequency
): Date {
  switch (frequency) {
    case 'daily':
      return addDays(currentDate, 1);
    case 'weekly':
      return addWeeks(currentDate, 1);
    case 'monthly':
      return addMonths(currentDate, 1);
    case 'yearly':
      return addYears(currentDate, 1);
    default:
      return addMonths(currentDate, 1);
  }
}

export const useRecurringTransactionStore = create<RecurringTransactionStore>()((set, get) => ({
  // State
  recurringTransactions: [],
  isLoading: false,
  error: null,

  // Fetch recurring transactions from API
  fetchRecurringTransactions: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.recurring.$get({
        query: {
          businessId: filters?.businessId,
          personalAccountId: filters?.personalAccountId,
          entityType: filters?.entityType,
          isActive: filters?.isActive,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch recurring transactions');
      }

      const data = await res.json();
      set({
        recurringTransactions: data.map((r) => ({
          id: r.id,
          entityId: r.businessId ?? r.personalAccountId ?? '',
          entityType: r.entityType,
          type: r.type,
          amount: r.amount,
          currency: r.currency,
          exchangeRate: r.exchangeRate,
          description: r.description,
          category: r.category,
          frequency: r.frequency,
          startDate: parseLocalDate(r.startDate),
          endDate: r.endDate ? parseLocalDate(r.endDate) : undefined,
          nextDueDate: parseLocalDate(r.nextDueDate),
          lastGeneratedDate: r.lastGeneratedDate ? parseLocalDate(r.lastGeneratedDate) : undefined,
          isActive: r.isActive,
          autoGenerateTransaction: r.autoGenerateTransaction,
          createdAt: new Date(r.createdAt),
          updatedAt: new Date(r.updatedAt),
        })),
        isLoading: false,
      });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Create recurring transaction via API
  addRecurringTransaction: async (input: CreateRecurringTransactionInput) => {
    set({ isLoading: true, error: null });
    try {
      const startDate = input.startDate instanceof Date ? input.startDate : parseLocalDate(input.startDate);
      
      const res = await client.v1.recurring.$post({
        json: {
          entityType: input.entityType,
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
          category: input.category,
          frequency: input.frequency,
          startDate: startDate.toISOString(),
          endDate: input.endDate 
            ? (input.endDate instanceof Date ? input.endDate.toISOString() : input.endDate)
            : undefined,
          autoGenerateTransaction: input.autoGenerateTransaction,
          businessId: input.entityType === 'business' ? input.entityId : undefined,
          personalAccountId: input.entityType === 'personal' ? input.entityId : undefined,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to create recurring transaction');
      }

      const data = await res.json();
      const newRecurring: RecurringTransaction = {
        id: data.id,
        entityId: data.businessId ?? data.personalAccountId ?? '',
        entityType: data.entityType,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        description: data.description,
        category: data.category,
        frequency: data.frequency,
        startDate: parseLocalDate(data.startDate),
        endDate: data.endDate ? parseLocalDate(data.endDate) : undefined,
        nextDueDate: parseLocalDate(data.nextDueDate),
        lastGeneratedDate: data.lastGeneratedDate ? parseLocalDate(data.lastGeneratedDate) : undefined,
        isActive: data.isActive,
        autoGenerateTransaction: data.autoGenerateTransaction,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        recurringTransactions: [...state.recurringTransactions, newRecurring],
        isLoading: false,
      }));

      return newRecurring;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  // Update recurring transaction via API
  updateRecurringTransaction: async (id: string, input: UpdateRecurringTransactionInput) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.recurring[':id'].$put({
        param: { id },
        json: {
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
          category: input.category,
          frequency: input.frequency,
          startDate: input.startDate 
            ? (input.startDate instanceof Date ? input.startDate.toISOString() : input.startDate)
            : undefined,
          endDate: input.endDate 
            ? (input.endDate instanceof Date ? input.endDate.toISOString() : input.endDate)
            : input.endDate === null ? null : undefined,
          isActive: input.isActive,
          autoGenerateTransaction: input.autoGenerateTransaction,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to update recurring transaction');
      }

      const data = await res.json();
      set((state) => ({
        recurringTransactions: state.recurringTransactions.map((rt) =>
          rt.id === id
            ? {
                id: data.id,
                entityId: data.businessId ?? data.personalAccountId ?? '',
                entityType: data.entityType,
                type: data.type,
                amount: data.amount,
                currency: data.currency,
                exchangeRate: data.exchangeRate,
                description: data.description,
                category: data.category,
                frequency: data.frequency,
                startDate: parseLocalDate(data.startDate),
                endDate: data.endDate ? parseLocalDate(data.endDate) : undefined,
                nextDueDate: parseLocalDate(data.nextDueDate),
                lastGeneratedDate: data.lastGeneratedDate ? parseLocalDate(data.lastGeneratedDate) : undefined,
                isActive: data.isActive,
                autoGenerateTransaction: data.autoGenerateTransaction,
                createdAt: new Date(data.createdAt),
                updatedAt: new Date(data.updatedAt),
              }
            : rt
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Delete recurring transaction via API
  deleteRecurringTransaction: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.recurring[':id'].$delete({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to delete recurring transaction');
      }

      set((state) => ({
        recurringTransactions: state.recurringTransactions.filter((rt) => rt.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Toggle recurring transaction via API
  toggleRecurringTransaction: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.recurring[':id'].toggle.$post({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to toggle recurring transaction');
      }

      const data = await res.json();
      set((state) => ({
        recurringTransactions: state.recurringTransactions.map((rt) =>
          rt.id === id
            ? {
                ...rt,
                isActive: data.isActive,
                updatedAt: new Date(data.updatedAt),
              }
            : rt
        ),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Mark recurring transaction as paid - creates a transaction and advances to next due date
  markAsPaid: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.recurring[':id']['mark-paid'].$post({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to mark recurring transaction as paid');
      }

      const data = await res.json();
      
      // Update the recurring transaction in local state
      set((state) => ({
        recurringTransactions: state.recurringTransactions.map((rt) =>
          rt.id === id
            ? {
                ...rt,
                nextDueDate: parseLocalDate(data.recurring.nextDueDate),
                lastGeneratedDate: data.recurring.lastGeneratedDate 
                  ? parseLocalDate(data.recurring.lastGeneratedDate) 
                  : undefined,
                updatedAt: new Date(data.recurring.updatedAt),
              }
            : rt
        ),
        isLoading: false,
      }));

      // Return the result so the caller can add the transaction to the transaction store
      return {
        transaction: {
          id: data.transaction.id,
          entityId: data.transaction.businessId ?? data.transaction.personalAccountId ?? '',
          entityType: data.transaction.entityType as EntityType,
          type: data.transaction.type as 'income' | 'expense' | 'investment',
          amount: data.transaction.amount,
          currency: data.transaction.currency,
          exchangeRate: data.transaction.exchangeRate,
          description: data.transaction.description,
          category: data.transaction.category,
          date: parseLocalDate(data.transaction.date),
          isTaxDeductible: data.transaction.isTaxDeductible,
          recurringTransactionId: data.transaction.recurringTransactionId ?? undefined,
          createdAt: new Date(data.transaction.createdAt),
          updatedAt: new Date(data.transaction.updatedAt),
        },
        recurring: {
          id: data.recurring.id,
          entityId: data.recurring.businessId ?? data.recurring.personalAccountId ?? '',
          entityType: data.recurring.entityType as EntityType,
          type: data.recurring.type as 'income' | 'expense' | 'investment',
          amount: data.recurring.amount,
          currency: data.recurring.currency,
          exchangeRate: data.recurring.exchangeRate,
          description: data.recurring.description,
          category: data.recurring.category,
          frequency: data.recurring.frequency as RecurrenceFrequency,
          startDate: parseLocalDate(data.recurring.startDate),
          endDate: data.recurring.endDate ? parseLocalDate(data.recurring.endDate) : undefined,
          nextDueDate: parseLocalDate(data.recurring.nextDueDate),
          lastGeneratedDate: data.recurring.lastGeneratedDate
            ? parseLocalDate(data.recurring.lastGeneratedDate)
            : undefined,
          isActive: data.recurring.isActive,
          autoGenerateTransaction: data.recurring.autoGenerateTransaction,
          createdAt: new Date(data.recurring.createdAt),
          updatedAt: new Date(data.recurring.updatedAt),
        },
      };
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  // Update the last generated date for a recurring transaction
  updateLastGeneratedDate: async (id: string, date: Date) => {
    try {
      await client.v1.recurring[':id'].$put({
        param: { id },
        json: {
          // The backend will update lastGeneratedDate automatically when we update
          // For now, we'll just update local state since this is a derived field
        },
      });

      // Even if API call fails, update local state for immediate UI feedback
      // The next sync will correct it
      set((state) => ({
        recurringTransactions: state.recurringTransactions.map((rt) =>
          rt.id === id
            ? {
                ...rt,
                lastGeneratedDate: date,
                nextDueDate: calculateNextDueDate(date, rt.frequency),
              }
            : rt
        ),
      }));
    } catch (error) {
      console.error('Failed to update last generated date:', error);
    }
  },

  getRecurringTransactionsByEntity: (entityId, entityType) => {
    return get().recurringTransactions.filter(
      (rt) => rt.entityId === entityId && rt.entityType === entityType
    );
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  
  reset: () => {
    set({
      recurringTransactions: [],
      isLoading: false,
      error: null,
    });
  },
}));
