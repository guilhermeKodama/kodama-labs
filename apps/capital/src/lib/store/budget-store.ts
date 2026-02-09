import { create } from 'zustand';
import type {
  Budget,
  CreateBudgetInput,
  UpdateBudgetInput,
  EntityType,
} from '@/types';
import { client } from '@/lib/api-client';

interface BudgetState {
  budgets: Budget[];
  isLoading: boolean;
  error: string | null;
}

interface BudgetActions {
  fetchBudgets: (filters?: {
    businessId?: string;
    personalAccountId?: string;
    entityType?: EntityType;
    year?: number;
    month?: number;
  }) => Promise<void>;
  addBudget: (input: CreateBudgetInput) => Promise<Budget | null>;
  updateBudget: (id: string, input: UpdateBudgetInput) => Promise<void>;
  deleteBudget: (id: string) => Promise<void>;
  toggleBudget: (id: string) => Promise<void>;
  getBudgetsByEntity: (entityId: string, entityType: EntityType) => Budget[];
  getBudgetsByPeriod: (year: number, month?: number) => Budget[];
  getBudgetByCategory: (entityId: string, category: string, year: number, month?: number) => Budget | undefined;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type BudgetStore = BudgetState & BudgetActions;

export const useBudgetStore = create<BudgetStore>()((set, get) => ({
  // State
  budgets: [],
  isLoading: false,
  error: null,

  // Fetch budgets from API
  fetchBudgets: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.budgets.$get({
        query: {
          businessId: filters?.businessId,
          personalAccountId: filters?.personalAccountId,
          entityType: filters?.entityType,
          year: filters?.year,
          month: filters?.month,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch budgets');
      }

      const data = await res.json();
      set({
        budgets: data.map((b) => ({
          id: b.id,
          entityId: b.businessId ?? b.personalAccountId ?? '',
          entityType: b.entityType,
          category: b.category,
          amount: b.amount,
          currency: b.currency,
          period: b.period,
          year: b.year,
          month: b.month ?? undefined,
          alertThreshold: (b as Record<string, unknown>).alertThreshold as number | undefined,
          isActive: b.isActive,
          createdAt: new Date(b.createdAt),
          updatedAt: new Date(b.updatedAt),
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

  // Create budget via API
  addBudget: async (input: CreateBudgetInput) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.budgets.$post({
        json: {
          entityType: input.entityType,
          category: input.category,
          amount: input.amount,
          currency: input.currency,
          period: input.period,
          year: input.year,
          month: input.month,
          businessId: input.entityType === 'business' ? input.entityId : undefined,
          personalAccountId: input.entityType === 'personal' ? input.entityId : undefined,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to create budget');
      }

      const data = await res.json();
      const newBudget: Budget = {
        id: data.id,
        entityId: data.businessId ?? data.personalAccountId ?? '',
        entityType: data.entityType,
        category: data.category,
        amount: data.amount,
        currency: data.currency,
        period: data.period,
        year: data.year,
        month: data.month ?? undefined,
        isActive: data.isActive,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        budgets: [...state.budgets, newBudget],
        isLoading: false,
      }));

      return newBudget;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  // Update budget via API
  updateBudget: async (id: string, input: UpdateBudgetInput) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.budgets[':id'].$put({
        param: { id },
        json: {
          category: input.category,
          amount: input.amount,
          currency: input.currency,
          period: input.period,
          year: input.year,
          month: input.month,
          isActive: input.isActive,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to update budget');
      }

      const data = await res.json();
      set((state) => ({
        budgets: state.budgets.map((budget) =>
          budget.id === id
            ? {
                id: data.id,
                entityId: data.businessId ?? data.personalAccountId ?? '',
                entityType: data.entityType,
                category: data.category,
                amount: data.amount,
                currency: data.currency,
                period: data.period,
                year: data.year,
                month: data.month ?? undefined,
                isActive: data.isActive,
                createdAt: new Date(data.createdAt),
                updatedAt: new Date(data.updatedAt),
              }
            : budget
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

  // Delete budget via API
  deleteBudget: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.budgets[':id'].$delete({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to delete budget');
      }

      set((state) => ({
        budgets: state.budgets.filter((b) => b.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Toggle budget active status via API
  toggleBudget: async (id: string) => {
    const budget = get().budgets.find((b) => b.id === id);
    if (!budget) return;

    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.budgets[':id'].$put({
        param: { id },
        json: {
          isActive: !budget.isActive,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to toggle budget');
      }

      const data = await res.json();
      set((state) => ({
        budgets: state.budgets.map((b) =>
          b.id === id
            ? {
                ...b,
                isActive: data.isActive,
                updatedAt: new Date(data.updatedAt),
              }
            : b
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
  
  reset: () => {
    set({
      budgets: [],
      isLoading: false,
      error: null,
    });
  },
}));
