import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  Transaction,
  CreateTransactionInput,
  UpdateTransactionInput,
  EntityType,
  TransactionType,
} from '@/types';

interface TransactionState {
  transactions: Transaction[];
  isLoading: boolean;
  error: string | null;
}

interface TransactionActions {
  addTransaction: (input: CreateTransactionInput) => Transaction;
  updateTransaction: (id: string, input: UpdateTransactionInput) => void;
  deleteTransaction: (id: string) => void;
  getTransactionsByEntity: (entityId: string, entityType: EntityType) => Transaction[];
  getTransactionsByType: (type: TransactionType) => Transaction[];
  deleteTransactionsByEntity: (entityId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

type TransactionStore = TransactionState & TransactionActions;

const generateId = () => crypto.randomUUID();

export const useTransactionStore = create<TransactionStore>()(
  persist(
    (set, get) => ({
      // State
      transactions: [],
      isLoading: false,
      error: null,

      // Actions
      addTransaction: (input) => {
        const newTransaction: Transaction = {
          id: generateId(),
          entityId: input.entityId,
          entityType: input.entityType,
          type: input.type,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate ?? 1,
          description: input.description,
          category: input.category,
          date: input.date,
          isTaxDeductible: input.isTaxDeductible,
          recurringTransactionId: input.recurringTransactionId,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        set((state) => ({
          transactions: [...state.transactions, newTransaction],
        }));

        return newTransaction;
      },

      updateTransaction: (id, input) => {
        set((state) => ({
          transactions: state.transactions.map((transaction) =>
            transaction.id === id
              ? { ...transaction, ...input, updatedAt: new Date() }
              : transaction
          ),
        }));
      },

      deleteTransaction: (id) => {
        set((state) => ({
          transactions: state.transactions.filter((t) => t.id !== id),
        }));
      },

      getTransactionsByEntity: (entityId, entityType) => {
        return get().transactions.filter(
          (t) => t.entityId === entityId && t.entityType === entityType
        );
      },

      getTransactionsByType: (type) => {
        return get().transactions.filter((t) => t.type === type);
      },

      deleteTransactionsByEntity: (entityId) => {
        set((state) => ({
          transactions: state.transactions.filter((t) => t.entityId !== entityId),
        }));
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
    }),
    {
      name: 'capital-transactions',
      partialize: (state) => ({ transactions: state.transactions }),
    }
  )
);
