import { create } from 'zustand';
import { parseLocalDate } from '@/lib/utils/date';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  EntityType,
  TransactionType,
} from '@/types';
import { client } from '@/lib/api-client';

interface TransactionState {
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
}

interface TransactionActions {
  fetchTransactions: (filters?: {
    businessId?: string;
    personalAccountId?: string;
    entityType?: EntityType;
    type?: TransactionType;
  }) => Promise<void>;
  addTransaction: (input: CreateTransactionInput) => Promise<Transaction | null>;
  updateTransaction: (id: string, input: UpdateTransactionInput) => Promise<void>;
  deleteTransaction: (id: string) => Promise<void>;
  deleteTransactionsByEntity: (entityId: string) => Promise<void>;
  getTransactionsByEntity: (entityId: string, entityType: EntityType) => Transaction[];
  getTransactionsByType: (type: TransactionType) => Transaction[];
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type TransactionStore = TransactionState & TransactionActions;

export const useTransactionStore = create<TransactionStore>()((set, get) => ({
  // State
  transactions: [],
  isLoading: false,
  error: null,

  // Fetch transactions from API
  fetchTransactions: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.transactions.$get({
        query: {
          businessId: filters?.businessId,
          personalAccountId: filters?.personalAccountId,
          entityType: filters?.entityType,
          type: filters?.type,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch transactions');
      }

      const data = await res.json();
      set({
        transactions: data.map((t) => ({
          id: t.id,
          entityId: t.businessId ?? t.personalAccountId ?? '',
          entityType: t.entityType,
          type: t.type,
          amount: t.amount,
          currency: t.currency,
          exchangeRate: t.exchangeRate,
          description: t.description,
          category: t.category,
          date: parseLocalDate(t.date),
          isTaxDeductible: t.isTaxDeductible,
          recurringTransactionId: t.recurringTransactionId ?? undefined,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
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

  // Create transaction via API
  addTransaction: async (input: CreateTransactionInput) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.transactions.$post({
        json: {
          entityType: input.entityType,
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
          category: input.category,
          date: input.date instanceof Date ? input.date.toISOString() : input.date,
          isTaxDeductible: input.isTaxDeductible,
          businessId: input.entityType === 'business' ? input.entityId : undefined,
          personalAccountId: input.entityType === 'personal' ? input.entityId : undefined,
          recurringTransactionId: input.recurringTransactionId,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to create transaction');
      }

      const data = await res.json();
      const newTransaction: Transaction = {
        id: data.id,
        entityId: data.businessId ?? data.personalAccountId ?? '',
        entityType: data.entityType,
        type: data.type,
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        description: data.description,
        category: data.category,
        date: parseLocalDate(data.date),
        isTaxDeductible: data.isTaxDeductible,
        recurringTransactionId: data.recurringTransactionId ?? undefined,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        transactions: [...state.transactions, newTransaction],
        isLoading: false,
      }));

      return newTransaction;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  // Update transaction via API
  updateTransaction: async (id: string, input: UpdateTransactionInput) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.transactions[':id'].$put({
        param: { id },
        json: {
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
          category: input.category,
          date: input.date instanceof Date ? input.date.toISOString() : input.date,
          isTaxDeductible: input.isTaxDeductible,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to update transaction');
      }

      const data = await res.json();
      set((state) => ({
        transactions: state.transactions.map((transaction) =>
          transaction.id === id
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
                date: parseLocalDate(data.date),
                isTaxDeductible: data.isTaxDeductible,
                recurringTransactionId: data.recurringTransactionId ?? undefined,
                createdAt: new Date(data.createdAt),
                updatedAt: new Date(data.updatedAt),
              }
            : transaction
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

  // Delete transaction via API
  deleteTransaction: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.transactions[':id'].$delete({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to delete transaction');
      }

      set((state) => ({
        transactions: state.transactions.filter((t) => t.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  getTransactionsByEntity: (entityId, entityType) => {
    return get().transactions.filter(
      (t) => t.entityId === entityId && t.entityType === entityType
    );
  },

  getTransactionsByType: (type) => {
    return get().transactions.filter((t) => t.type === type);
  },

  // Delete all transactions for an entity (used when deleting a business/personal account)
  deleteTransactionsByEntity: async (entityId: string) => {
    const transactions = get().transactions.filter((t) => t.entityId === entityId);
    
    // Delete each transaction via API
    for (const transaction of transactions) {
      try {
        await client.v1.transactions[':id'].$delete({
          param: { id: transaction.id },
        });
      } catch (error) {
        console.error(`Failed to delete transaction ${transaction.id}:`, error);
      }
    }
    
    // Update local state
    set((state) => ({
      transactions: state.transactions.filter((t) => t.entityId !== entityId),
    }));
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  
  reset: () => {
    set({
      transactions: [],
      isLoading: false,
      error: null,
    });
  },
}));
