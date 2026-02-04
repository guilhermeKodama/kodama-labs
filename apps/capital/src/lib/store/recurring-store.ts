import { create } from 'zustand';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';
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
          startDate: new Date(r.startDate),
          endDate: r.endDate ? new Date(r.endDate) : undefined,
          nextDueDate: new Date(r.nextDueDate),
          lastGeneratedDate: r.lastGeneratedDate ? new Date(r.lastGeneratedDate) : undefined,
          isActive: r.isActive,
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
      const startDate = input.startDate instanceof Date ? input.startDate : new Date(input.startDate);
      
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
        startDate: new Date(data.startDate),
        endDate: data.endDate ? new Date(data.endDate) : undefined,
        nextDueDate: new Date(data.nextDueDate),
        lastGeneratedDate: data.lastGeneratedDate ? new Date(data.lastGeneratedDate) : undefined,
        isActive: data.isActive,
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
                startDate: new Date(data.startDate),
                endDate: data.endDate ? new Date(data.endDate) : undefined,
                nextDueDate: new Date(data.nextDueDate),
                lastGeneratedDate: data.lastGeneratedDate ? new Date(data.lastGeneratedDate) : undefined,
                isActive: data.isActive,
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

  // Update the last generated date for a recurring transaction
  updateLastGeneratedDate: async (id: string, date: Date) => {
    try {
      const res = await client.v1.recurring[':id'].$put({
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
