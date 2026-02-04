import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Budget,
  CreateBudgetInput,
  UpdateBudgetInput,
  EntityType,
  BudgetPeriod,
} from '@/types';

interface BudgetState {
  budgets: Budget[];
  isLoading: boolean;
  error: string | null;
}

interface BudgetActions {
  addBudget: (input: CreateBudgetInput) => Budget;
  updateBudget: (id: string, input: UpdateBudgetInput) => void;
  deleteBudget: (id: string) => void;
  toggleBudget: (id: string) => void;
  getBudgetsByEntity: (entityId: string, entityType: EntityType) => Budget[];
  getBudgetsByPeriod: (year: number, month?: number) => Budget[];
  getBudgetByCategory: (entityId: string, category: string, year: number, month?: number) => Budget | undefined;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

type BudgetStore = BudgetState & BudgetActions;

const generateId = () => crypto.randomUUID();

export const useBudgetStore = create<BudgetStore>()(
  persist(
    (set, get) => ({
      // State
      budgets: [],
      isLoading: false,
      error: null,

      // Actions
      addBudget: (input) => {
        const now = new Date();

        const newBudget: Budget = {
          id: generateId(),
          entityId: input.entityId,
          entityType: input.entityType,
          category: input.category,
          amount: input.amount,
          currency: input.currency,
          period: input.period,
          year: input.year,
          month: input.period === 'monthly' ? input.month : undefined,
          isActive: true,
          createdAt: now,
          updatedAt: now,
        };

        set((state) => ({
          budgets: [...state.budgets, newBudget],
        }));

        return newBudget;
      },

      updateBudget: (id, input) => {
        set((state) => ({
          budgets: state.budgets.map((budget) =>
            budget.id === id
              ? { ...budget, ...input, updatedAt: new Date() }
              : budget
          ),
        }));
      },

      deleteBudget: (id) => {
        set((state) => ({
          budgets: state.budgets.filter((b) => b.id !== id),
        }));
      },

      toggleBudget: (id) => {
        set((state) => ({
          budgets: state.budgets.map((budget) =>
            budget.id === id
              ? { ...budget, isActive: !budget.isActive, updatedAt: new Date() }
              : budget
          ),
        }));
      },

      getBudgetsByEntity: (entityId, entityType) => {
        return get().budgets.filter(
          (b) => b.entityId === entityId && b.entityType === entityType
        );
      },

      getBudgetsByPeriod: (year, month) => {
        return get().budgets.filter((b) => {
          if (b.year !== year) return false;
          if (month !== undefined && b.period === 'monthly') {
            return b.month === month;
          }
          return true;
        });
      },

      getBudgetByCategory: (entityId, category, year, month) => {
        return get().budgets.find((b) => {
          if (b.entityId !== entityId || b.category !== category || b.year !== year) {
            return false;
          }
          if (month !== undefined && b.period === 'monthly') {
            return b.month === month;
          }
          return b.period === 'yearly';
        });
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
    }),
    {
      name: 'capital-budgets',
      partialize: (state) => ({ budgets: state.budgets }),
    }
  )
);
