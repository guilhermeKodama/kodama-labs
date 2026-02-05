import { create } from 'zustand';
import { addDays, addWeeks, addMonths, addYears } from 'date-fns';
import type {
  RecurringTransfer,
  CreateRecurringTransferInput,
  UpdateRecurringTransferInput,
  Transfer,
  EntityType,
  TransferDirection,
  RecurrenceFrequency,
} from '@/types';
import { client } from '@/lib/api-client';

interface RecurringTransferState {
  recurringTransfers: RecurringTransfer[];
  isLoading: boolean;
  error: string | null;
}

interface MarkAsPaidResult {
  transfer: Transfer;
  recurring: RecurringTransfer;
}

interface RecurringTransferActions {
  fetchRecurringTransfers: (filters?: {
    fromBusinessId?: string;
    fromPersonalAccountId?: string;
    toBusinessId?: string;
    toPersonalAccountId?: string;
    fromEntityType?: EntityType;
    toEntityType?: EntityType;
    isActive?: boolean;
  }) => Promise<void>;
  addRecurringTransfer: (input: CreateRecurringTransferInput) => Promise<RecurringTransfer | null>;
  updateRecurringTransfer: (id: string, input: UpdateRecurringTransferInput) => Promise<void>;
  deleteRecurringTransfer: (id: string) => Promise<void>;
  toggleRecurringTransfer: (id: string) => Promise<void>;
  markAsPaid: (id: string) => Promise<MarkAsPaidResult | null>;
  getRecurringTransfersByEntity: (entityId: string) => RecurringTransfer[];
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type RecurringTransferStore = RecurringTransferState & RecurringTransferActions;

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

export const useRecurringTransferStore = create<RecurringTransferStore>()((set, get) => ({
  // State
  recurringTransfers: [],
  isLoading: false,
  error: null,

  // Fetch recurring transfers from API
  fetchRecurringTransfers: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['recurring-transfers'].$get({
        query: {
          fromBusinessId: filters?.fromBusinessId,
          fromPersonalAccountId: filters?.fromPersonalAccountId,
          toBusinessId: filters?.toBusinessId,
          toPersonalAccountId: filters?.toPersonalAccountId,
          fromEntityType: filters?.fromEntityType,
          toEntityType: filters?.toEntityType,
          isActive: filters?.isActive,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch recurring transfers');
      }

      const data = await res.json();
      set({
        recurringTransfers: data.map((r) => ({
          id: r.id,
          fromEntityId: r.fromBusinessId ?? r.fromPersonalAccountId ?? '',
          fromEntityType: r.fromEntityType,
          toEntityId: r.toBusinessId ?? r.toPersonalAccountId ?? '',
          toEntityType: r.toEntityType,
          direction: r.direction,
          amount: r.amount,
          currency: r.currency,
          exchangeRate: r.exchangeRate,
          description: r.description ?? undefined,
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

  // Create recurring transfer via API
  addRecurringTransfer: async (input: CreateRecurringTransferInput) => {
    set({ isLoading: true, error: null });
    try {
      const startDate = input.startDate instanceof Date ? input.startDate : new Date(input.startDate);
      
      const res = await client.v1['recurring-transfers'].$post({
        json: {
          fromEntityType: input.fromEntityType,
          toEntityType: input.toEntityType,
          direction: input.direction,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
          frequency: input.frequency,
          startDate: startDate.toISOString(),
          endDate: input.endDate 
            ? (input.endDate instanceof Date ? input.endDate.toISOString() : input.endDate)
            : undefined,
          fromBusinessId: input.fromEntityType === 'business' ? input.fromEntityId : undefined,
          fromPersonalAccountId: input.fromEntityType === 'personal' ? input.fromEntityId : undefined,
          toBusinessId: input.toEntityType === 'business' ? input.toEntityId : undefined,
          toPersonalAccountId: input.toEntityType === 'personal' ? input.toEntityId : undefined,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to create recurring transfer');
      }

      const data = await res.json();
      const newRecurring: RecurringTransfer = {
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
        recurringTransfers: [...state.recurringTransfers, newRecurring],
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

  // Update recurring transfer via API
  updateRecurringTransfer: async (id: string, input: UpdateRecurringTransferInput) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['recurring-transfers'][':id'].$put({
        param: { id },
        json: {
          direction: input.direction,
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
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
        throw new Error('Failed to update recurring transfer');
      }

      const data = await res.json();
      set((state) => ({
        recurringTransfers: state.recurringTransfers.map((rt) =>
          rt.id === id
            ? {
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

  // Delete recurring transfer via API
  deleteRecurringTransfer: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['recurring-transfers'][':id'].$delete({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to delete recurring transfer');
      }

      set((state) => ({
        recurringTransfers: state.recurringTransfers.filter((rt) => rt.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Toggle recurring transfer via API
  toggleRecurringTransfer: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['recurring-transfers'][':id'].toggle.$post({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to toggle recurring transfer');
      }

      const data = await res.json();
      set((state) => ({
        recurringTransfers: state.recurringTransfers.map((rt) =>
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

  // Mark recurring transfer as paid - creates a transfer and advances to next due date
  markAsPaid: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['recurring-transfers'][':id']['mark-paid'].$post({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to mark recurring transfer as paid');
      }

      const data = await res.json();
      
      // Update the recurring transfer in local state
      set((state) => ({
        recurringTransfers: state.recurringTransfers.map((rt) =>
          rt.id === id
            ? {
                ...rt,
                nextDueDate: new Date(data.updatedRecurring.nextDueDate),
                lastGeneratedDate: data.updatedRecurring.lastGeneratedDate 
                  ? new Date(data.updatedRecurring.lastGeneratedDate) 
                  : undefined,
                updatedAt: new Date(data.updatedRecurring.updatedAt),
              }
            : rt
        ),
        isLoading: false,
      }));

      // Return the result so the caller can add the transfer to the transfer store
      return {
        transfer: {
          id: data.createdTransfer.id,
          fromEntityId: data.createdTransfer.fromBusinessId ?? data.createdTransfer.fromPersonalAccountId ?? '',
          fromEntityType: data.createdTransfer.fromEntityType as EntityType,
          toEntityId: data.createdTransfer.toBusinessId ?? data.createdTransfer.toPersonalAccountId ?? '',
          toEntityType: data.createdTransfer.toEntityType as EntityType,
          direction: data.createdTransfer.direction as TransferDirection,
          amount: data.createdTransfer.amount,
          currency: data.createdTransfer.currency,
          exchangeRate: data.createdTransfer.exchangeRate,
          description: data.createdTransfer.description ?? undefined,
          date: new Date(data.createdTransfer.date),
          createdAt: new Date(data.createdTransfer.createdAt),
          updatedAt: new Date(data.createdTransfer.updatedAt),
        } as Transfer,
        recurring: {
          id: data.updatedRecurring.id,
          fromEntityId: data.updatedRecurring.fromBusinessId ?? data.updatedRecurring.fromPersonalAccountId ?? '',
          fromEntityType: data.updatedRecurring.fromEntityType as EntityType,
          toEntityId: data.updatedRecurring.toBusinessId ?? data.updatedRecurring.toPersonalAccountId ?? '',
          toEntityType: data.updatedRecurring.toEntityType as EntityType,
          direction: data.updatedRecurring.direction as TransferDirection,
          amount: data.updatedRecurring.amount,
          currency: data.updatedRecurring.currency,
          exchangeRate: data.updatedRecurring.exchangeRate,
          description: data.updatedRecurring.description ?? undefined,
          frequency: data.updatedRecurring.frequency as RecurrenceFrequency,
          startDate: new Date(data.updatedRecurring.startDate),
          endDate: data.updatedRecurring.endDate ? new Date(data.updatedRecurring.endDate) : undefined,
          nextDueDate: new Date(data.updatedRecurring.nextDueDate),
          lastGeneratedDate: data.updatedRecurring.lastGeneratedDate 
            ? new Date(data.updatedRecurring.lastGeneratedDate) 
            : undefined,
          isActive: data.updatedRecurring.isActive,
          createdAt: new Date(data.updatedRecurring.createdAt),
          updatedAt: new Date(data.updatedRecurring.updatedAt),
        } as RecurringTransfer,
      };
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  getRecurringTransfersByEntity: (entityId) => {
    return get().recurringTransfers.filter(
      (rt) => rt.fromEntityId === entityId || rt.toEntityId === entityId
    );
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  
  reset: () => {
    set({
      recurringTransfers: [],
      isLoading: false,
      error: null,
    });
  },
}));
