import { create } from 'zustand';
import { parseLocalDate } from '@/lib/utils/date';
import type { Transfer, CreateTransferInput } from '@/types';
import { client } from '@/lib/api-client';

interface TransferState {
  transfers: Transfer[];
  isLoading: boolean;
  error: string | null;
}

interface TransferActions {
  fetchTransfers: (filters?: {
    fromBusinessId?: string;
    fromPersonalAccountId?: string;
    toBusinessId?: string;
    toPersonalAccountId?: string;
  }) => Promise<void>;
  addTransfer: (input: CreateTransferInput) => Promise<Transfer | null>;
  deleteTransfer: (id: string) => Promise<void>;
  deleteTransfersByEntity: (entityId: string) => Promise<void>;
  getTransfersByEntity: (entityId: string) => Transfer[];
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type TransferStore = TransferState & TransferActions;

export const useTransferStore = create<TransferStore>()((set, get) => ({
  // State
  transfers: [],
  isLoading: false,
  error: null,

  // Fetch transfers from API
  fetchTransfers: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.transfers.$get({
        query: filters ?? {},
      });

      if (!res.ok) {
        throw new Error('Failed to fetch transfers');
      }

      const data = await res.json();
      set({
        transfers: data.map((t) => ({
          id: t.id,
          fromEntityId: t.fromBusinessId ?? t.fromPersonalAccountId ?? '',
          fromEntityType: t.fromEntityType,
          toEntityId: t.toBusinessId ?? t.toPersonalAccountId ?? '',
          toEntityType: t.toEntityType,
          direction: t.direction,
          amount: t.amount,
          currency: t.currency,
          exchangeRate: t.exchangeRate,
          description: t.description ?? undefined,
          date: parseLocalDate(t.date),
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

  // Create transfer via API
  addTransfer: async (input: CreateTransferInput) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.transfers.$post({
        json: {
          fromEntityType: input.fromEntityType,
          toEntityType: input.toEntityType,
          direction: input.direction,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
          date: input.date instanceof Date ? input.date.toISOString() : input.date,
          fromBusinessId: input.fromEntityType === 'business' ? input.fromEntityId : undefined,
          fromPersonalAccountId: input.fromEntityType === 'personal' ? input.fromEntityId : undefined,
          toBusinessId: input.toEntityType === 'business' ? input.toEntityId : undefined,
          toPersonalAccountId: input.toEntityType === 'personal' ? input.toEntityId : undefined,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to create transfer');
      }

      const data = await res.json();
      const newTransfer: Transfer = {
        id: data.id,
        fromEntityId: data.fromBusinessId ?? data.fromPersonalAccountId ?? '',
        fromEntityType: data.fromEntityType,
        toEntityId: data.toBusinessId ?? data.toPersonalAccountId ?? '',
        toEntityType: data.toEntityType,
        direction: data.direction,
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        description: data.description ?? undefined,
        date: parseLocalDate(data.date),
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        transfers: [...state.transfers, newTransfer],
        isLoading: false,
      }));

      return newTransfer;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  // Delete transfer via API
  deleteTransfer: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.transfers[':id'].$delete({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to delete transfer');
      }

      set((state) => ({
        transfers: state.transfers.filter((t) => t.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  getTransfersByEntity: (entityId) => {
    return get().transfers.filter(
      (t) => t.fromEntityId === entityId || t.toEntityId === entityId
    );
  },

  // Delete all transfers involving an entity (used when deleting a business/personal account)
  deleteTransfersByEntity: async (entityId: string) => {
    const transfers = get().transfers.filter(
      (t) => t.fromEntityId === entityId || t.toEntityId === entityId
    );
    
    // Delete each transfer via API
    for (const transfer of transfers) {
      try {
        await client.v1.transfers[':id'].$delete({
          param: { id: transfer.id },
        });
      } catch (error) {
        console.error(`Failed to delete transfer ${transfer.id}:`, error);
      }
    }
    
    // Update local state
    set((state) => ({
      transfers: state.transfers.filter(
        (t) => t.fromEntityId !== entityId && t.toEntityId !== entityId
      ),
    }));
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  
  reset: () => {
    set({
      transfers: [],
      isLoading: false,
      error: null,
    });
  },
}));
