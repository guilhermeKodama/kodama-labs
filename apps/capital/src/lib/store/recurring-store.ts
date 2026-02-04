import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';
import type {
  RecurringTransaction,
  CreateRecurringTransactionInput,
  UpdateRecurringTransactionInput,
  EntityType,
  RecurrenceFrequency,
} from '@/types';

interface RecurringTransactionState {
  recurringTransactions: RecurringTransaction[];
  isLoading: boolean;
  error: string | null;
}

interface RecurringTransactionActions {
  addRecurringTransaction: (input: CreateRecurringTransactionInput) => RecurringTransaction;
  updateRecurringTransaction: (id: string, input: UpdateRecurringTransactionInput) => void;
  deleteRecurringTransaction: (id: string) => void;
  toggleRecurringTransaction: (id: string) => void;
  getRecurringTransactionsByEntity: (entityId: string, entityType: EntityType) => RecurringTransaction[];
  updateLastGeneratedDate: (id: string, date: Date) => void;
  updateNextDueDate: (id: string, date: Date) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

type RecurringTransactionStore = RecurringTransactionState & RecurringTransactionActions;

const generateId = () => crypto.randomUUID();

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

export const useRecurringTransactionStore = create<RecurringTransactionStore>()(
  persist(
    (set, get) => ({
      // State
      recurringTransactions: [],
      isLoading: false,
      error: null,

      // Actions
      addRecurringTransaction: (input) => {
        const now = new Date();
        const startDate = new Date(input.startDate);
        
        // Calculate initial next due date
        const nextDueDate = startDate > now ? startDate : calculateNextDueDate(startDate, input.frequency);

        const newRecurring: RecurringTransaction = {
          id: generateId(),
          entityId: input.entityId,
          entityType: input.entityType,
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate ?? 1,
          description: input.description,
          category: input.category,
          frequency: input.frequency,
          startDate: startDate,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          nextDueDate: nextDueDate,
          lastGeneratedDate: undefined,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          recurringTransactions: [...state.recurringTransactions, newRecurring],
        }));

        return newRecurring;
      },

      updateRecurringTransaction: (id, input) => {
        set((state) => ({
          recurringTransactions: state.recurringTransactions.map((rt) => {
            if (rt.id !== id) return rt;
            
            const updated = { ...rt, ...input, updatedAt: new Date() };
            
            // Recalculate next due date if frequency or start date changed
            if (input.frequency || input.startDate) {
              const baseDate = input.startDate 
                ? new Date(input.startDate) 
                : rt.lastGeneratedDate 
                  ? new Date(rt.lastGeneratedDate)
                  : new Date(rt.startDate);
              updated.nextDueDate = calculateNextDueDate(baseDate, input.frequency || rt.frequency);
            }
            
            return updated;
          }),
        }));
      },

      deleteRecurringTransaction: (id) => {
        set((state) => ({
          recurringTransactions: state.recurringTransactions.filter((rt) => rt.id !== id),
        }));
      },

      toggleRecurringTransaction: (id) => {
        set((state) => ({
          recurringTransactions: state.recurringTransactions.map((rt) =>
            rt.id === id
              ? { ...rt, isActive: !rt.isActive, updatedAt: new Date() }
              : rt
          ),
        }));
      },

      getRecurringTransactionsByEntity: (entityId, entityType) => {
        return get().recurringTransactions.filter(
          (rt) => rt.entityId === entityId && rt.entityType === entityType
        );
      },

      updateLastGeneratedDate: (id, date) => {
        set((state) => ({
          recurringTransactions: state.recurringTransactions.map((rt) =>
            rt.id === id
              ? { 
                  ...rt, 
                  lastGeneratedDate: date,
                  nextDueDate: calculateNextDueDate(date, rt.frequency),
                  updatedAt: new Date() 
                }
              : rt
          ),
        }));
      },

      updateNextDueDate: (id, date) => {
        set((state) => ({
          recurringTransactions: state.recurringTransactions.map((rt) =>
            rt.id === id
              ? { ...rt, nextDueDate: date, updatedAt: new Date() }
              : rt
          ),
        }));
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
    }),
    {
      name: 'capital-recurring-transactions',
      partialize: (state) => ({ recurringTransactions: state.recurringTransactions }),
    }
  )
);
