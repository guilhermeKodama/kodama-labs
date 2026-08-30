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
  updateTransfer: (id: string, input: CreateTransferInput) => Promise<Transfer | null>;
  deleteTransfer: (id: string) => Promise<boolean>;
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
          toInvestmentAccountId: (t as Record<string, unknown>).toInvestmentAccountId as string | undefined,
          fromInvestmentAccountId: (t as Record<string, unknown>).fromInvestmentAccountId as string | undefined,
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
      const isInvestmentDeposit = input.direction === 'investment_deposit';
      const isInvestmentWithdrawal = input.direction === 'investment_withdrawal';

      const body: Record<string, unknown> = {
        fromEntityType: input.fromEntityType,
        toEntityType: input.toEntityType,
        direction: input.direction,
        amount: input.amount,
        currency: input.currency,
        exchangeRate: input.exchangeRate,
        description: input.description,
        date: input.date instanceof Date ? input.date.toISOString() : input.date,
      };

      // Set entity IDs (skip when the side is an investment account)
      if (!isInvestmentWithdrawal && input.fromEntityId) {
        if (input.fromEntityType === 'business') body.fromBusinessId = input.fromEntityId;
        if (input.fromEntityType === 'personal') body.fromPersonalAccountId = input.fromEntityId;
      }
      if (!isInvestmentDeposit && input.toEntityId) {
        if (input.toEntityType === 'business') body.toBusinessId = input.toEntityId;
        if (input.toEntityType === 'personal') body.toPersonalAccountId = input.toEntityId;
      }

      // Set investment account IDs
      if (input.toInvestmentAccountId) body.toInvestmentAccountId = input.toInvestmentAccountId;
      if (input.fromInvestmentAccountId) body.fromInvestmentAccountId = input.fromInvestmentAccountId;

      // Use raw fetch to ensure all fields are sent (Hono typed client may strip new fields)
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${baseUrl}/api/v1/transfers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(
          (errorData as { error?: { message?: string } })?.error?.message
            || 'Failed to create transfer'
        );
      }

      // Refresh all transfers from the server to stay in sync
      await get().fetchTransfers();

      const transfers = get().transfers;
      return transfers[transfers.length - 1] || null;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  // Update transfer via API
  updateTransfer: async (id: string, input: CreateTransferInput) => {
    set({ isLoading: true, error: null });
    try {
      const isInvestmentDeposit = input.direction === 'investment_deposit';
      const isInvestmentWithdrawal = input.direction === 'investment_withdrawal';

      // Full replace: explicitly null out the from/to and investment fields that
      // no longer apply, so switching direction/entity type on edit doesn't leave
      // stale foreign keys behind.
      const body: Record<string, unknown> = {
        fromEntityType: input.fromEntityType,
        toEntityType: input.toEntityType,
        direction: input.direction,
        amount: input.amount,
        currency: input.currency,
        exchangeRate: input.exchangeRate,
        description: input.description ?? null,
        date: input.date instanceof Date ? input.date.toISOString() : input.date,
        fromBusinessId: !isInvestmentWithdrawal && input.fromEntityType === 'business' ? input.fromEntityId : null,
        fromPersonalAccountId: !isInvestmentWithdrawal && input.fromEntityType === 'personal' ? input.fromEntityId : null,
        toBusinessId: !isInvestmentDeposit && input.toEntityType === 'business' ? input.toEntityId : null,
        toPersonalAccountId: !isInvestmentDeposit && input.toEntityType === 'personal' ? input.toEntityId : null,
        toInvestmentAccountId: isInvestmentDeposit ? (input.toInvestmentAccountId ?? null) : null,
        fromInvestmentAccountId: isInvestmentWithdrawal ? (input.fromInvestmentAccountId ?? null) : null,
      };

      // Use raw fetch to ensure all fields (including explicit nulls) are sent
      const baseUrl = typeof window !== 'undefined' ? window.location.origin : '';
      const res = await fetch(`${baseUrl}/api/v1/transfers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(
          (errorData as { error?: { message?: string } })?.error?.message
            || 'Failed to update transfer'
        );
      }

      const data = await res.json();
      const updated: Transfer = {
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
        toInvestmentAccountId: data.toInvestmentAccountId ?? undefined,
        fromInvestmentAccountId: data.fromInvestmentAccountId ?? undefined,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        transfers: state.transfers.map((t) => (t.id === id ? updated : t)),
        isLoading: false,
      }));
      return updated;
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
      return true;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return false;
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
