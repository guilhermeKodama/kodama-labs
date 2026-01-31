import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Transfer, CreateTransferInput } from '@/types';

interface TransferState {
  transfers: Transfer[];
  isLoading: boolean;
  error: string | null;
}

interface TransferActions {
  addTransfer: (input: CreateTransferInput) => Transfer;
  deleteTransfer: (id: string) => void;
  getTransfersByEntity: (entityId: string) => Transfer[];
  deleteTransfersByEntity: (entityId: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

type TransferStore = TransferState & TransferActions;

const generateId = () => crypto.randomUUID();

export const useTransferStore = create<TransferStore>()(
  persist(
    (set, get) => ({
      // State
      transfers: [],
      isLoading: false,
      error: null,

      // Actions
      addTransfer: (input) => {
        const newTransfer: Transfer = {
          id: generateId(),
          fromEntityId: input.fromEntityId,
          fromEntityType: input.fromEntityType,
          toEntityId: input.toEntityId,
          toEntityType: input.toEntityType,
          direction: input.direction,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate ?? 1,
          description: input.description,
          date: input.date,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        set((state) => ({
          transfers: [...state.transfers, newTransfer],
        }));

        return newTransfer;
      },

      deleteTransfer: (id) => {
        set((state) => ({
          transfers: state.transfers.filter((t) => t.id !== id),
        }));
      },

      getTransfersByEntity: (entityId) => {
        return get().transfers.filter(
          (t) => t.fromEntityId === entityId || t.toEntityId === entityId
        );
      },

      deleteTransfersByEntity: (entityId) => {
        set((state) => ({
          transfers: state.transfers.filter(
            (t) => t.fromEntityId !== entityId && t.toEntityId !== entityId
          ),
        }));
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
    }),
    {
      name: 'capital-transfers',
      partialize: (state) => ({ transfers: state.transfers }),
    }
  )
);
