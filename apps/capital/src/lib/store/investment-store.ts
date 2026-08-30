import { create } from 'zustand';
import { parseLocalDate } from '@/lib/utils/date';
import type {
  InvestmentAccount,
  InvestmentHolding,
  InvestmentTransaction,
  CreateInvestmentAccountInput,
  UpdateInvestmentAccountInput,
  CreateInvestmentHoldingInput,
  UpdateInvestmentHoldingInput,
  CreateInvestmentTransactionInput,
  UpdateInvestmentTransactionInput,
  PortfolioSummary,
  AssetClass,
  FixedIncomeSubType,
  InvestmentTransactionType,
  EntityType,
} from '@/types';
import { client } from '@/lib/api-client';

// ============================================
// State
// ============================================

interface InvestmentState {
  accounts: InvestmentAccount[];
  holdings: InvestmentHolding[];
  transactions: InvestmentTransaction[];
  portfolioSummary: PortfolioSummary | null;
  isLoading: boolean;
  error: string | null;
}

// ============================================
// Actions
// ============================================

interface InvestmentActions {
  // Accounts
  fetchAccounts: (filters?: { entityType?: EntityType }) => Promise<void>;
  addAccount: (input: CreateInvestmentAccountInput) => Promise<InvestmentAccount | null>;
  updateAccount: (id: string, input: UpdateInvestmentAccountInput) => Promise<boolean>;
  deleteAccount: (id: string) => Promise<void>;

  // Holdings
  fetchHoldings: (filters?: { accountId?: string; assetClass?: AssetClass; isActive?: boolean }) => Promise<void>;
  addHolding: (input: CreateInvestmentHoldingInput) => Promise<InvestmentHolding | null>;
  updateHolding: (id: string, input: UpdateInvestmentHoldingInput) => Promise<boolean>;
  deleteHolding: (id: string) => Promise<void>;

  // Transactions
  fetchTransactions: (filters?: {
    holdingId?: string;
    accountId?: string;
    type?: InvestmentTransactionType;
  }) => Promise<void>;
  addTransaction: (input: CreateInvestmentTransactionInput) => Promise<InvestmentTransaction | null>;
  updateTransaction: (id: string, input: UpdateInvestmentTransactionInput) => Promise<boolean>;
  deleteTransaction: (id: string) => Promise<void>;

  // Fund / Withdraw
  fundAccount: (accountId: string, input: { amount: number; currency: string; exchangeRate?: number; description?: string; date: Date }) => Promise<boolean>;
  withdrawAccount: (accountId: string, input: { amount: number; currency: string; exchangeRate?: number; description?: string; date: Date }) => Promise<boolean>;

  // Portfolio
  fetchPortfolioSummary: () => Promise<void>;

  // Utilities
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type InvestmentStore = InvestmentState & InvestmentActions;

const initialState: InvestmentState = {
  accounts: [],
  holdings: [],
  transactions: [],
  portfolioSummary: null,
  isLoading: false,
  error: null,
};

// ============================================
// Store
// ============================================

export const useInvestmentStore = create<InvestmentStore>()((set, get) => ({
  ...initialState,

  // ----------------------------------------
  // Accounts
  // ----------------------------------------
  fetchAccounts: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-accounts'].$get({
        query: {
          entityType: filters?.entityType,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch investment accounts');

      const data = await res.json();
      set({
        accounts: data.map((a) => ({
          id: a.id,
          userId: a.userId,
          name: a.name,
          broker: a.broker ?? undefined,
          entityId: a.businessId ?? a.personalAccountId ?? '',
          entityType: a.entityType as EntityType,
          currency: a.currency,
          cashBalance: Number((a as Record<string, unknown>).cashBalance) || 0,
          isActive: a.isActive,
          createdAt: new Date(a.createdAt),
          updatedAt: new Date(a.updatedAt),
        })),
        isLoading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
    }
  },

  addAccount: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-accounts'].$post({
        json: {
          name: input.name,
          broker: input.broker,
          entityType: input.entityType,
          currency: input.currency,
          businessId: input.entityType === 'business' ? input.businessId : undefined,
          personalAccountId: input.entityType === 'personal' ? input.personalAccountId : undefined,
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        console.error('Failed to create investment account:', res.status, errorData);
        throw new Error(
          (errorData as { error?: { message?: string } })?.error?.message
            || `Failed to create investment account (${res.status})`
        );
      }

      const data = await res.json();
      const newAccount: InvestmentAccount = {
        id: data.id,
        userId: data.userId,
        name: data.name,
        broker: data.broker ?? undefined,
        entityId: data.businessId ?? data.personalAccountId ?? '',
        entityType: data.entityType as EntityType,
        currency: data.currency,
        cashBalance: 0,
        isActive: data.isActive,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        accounts: [...state.accounts, newAccount],
        isLoading: false,
      }));

      return newAccount;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
      return null;
    }
  },

  updateAccount: async (id, input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-accounts'][':id'].$put({
        param: { id },
        json: input,
      });

      if (!res.ok) throw new Error('Failed to update investment account');

      const data = await res.json();
      set((state) => ({
        accounts: state.accounts.map((a) =>
          a.id === id
            ? {
                ...a,
                name: data.name,
                broker: data.broker ?? undefined,
                currency: data.currency,
                isActive: data.isActive,
                updatedAt: new Date(data.updatedAt),
              }
            : a
        ),
        isLoading: false,
      }));
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
      return false;
    }
  },

  deleteAccount: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-accounts'][':id'].$delete({
        param: { id },
      });

      if (!res.ok) throw new Error('Failed to delete investment account');

      set((state) => ({
        accounts: state.accounts.filter((a) => a.id !== id),
        holdings: state.holdings.filter((h) => h.accountId !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
    }
  },

  // ----------------------------------------
  // Holdings
  // ----------------------------------------
  fetchHoldings: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-holdings'].$get({
        query: {
          accountId: filters?.accountId,
          assetClass: filters?.assetClass,
          isActive: filters?.isActive === true ? 'true' : filters?.isActive === false ? 'false' : undefined,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch investment holdings');

      const data = await res.json();
      set({
        holdings: data.map((h): InvestmentHolding => ({
          id: h.id,
          accountId: h.accountId,
          assetClass: h.assetClass as AssetClass,
          subType: (h.subType as FixedIncomeSubType) ?? undefined,
          ticker: h.ticker ?? undefined,
          name: h.name,
          currency: h.currency,
          currentQuantity: h.currentQuantity,
          averageCost: h.averageCost,
          totalInvested: h.totalInvested,
          currentPrice: h.currentPrice ?? undefined,
          lastPriceUpdate: h.lastPriceUpdate ? new Date(h.lastPriceUpdate) : undefined,
          isActive: h.isActive,
          createdAt: new Date(h.createdAt),
          updatedAt: new Date(h.updatedAt),
          account: h.account
            ? {
                id: h.account.id,
                name: h.account.name,
                broker: h.account.broker ?? undefined,
                entityType: h.account.entityType as EntityType,
              }
            : undefined,
        })),
        isLoading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
    }
  },

  addHolding: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-holdings'].$post({
        json: input,
      });

      if (!res.ok) throw new Error('Failed to create investment holding');

      const data = await res.json();
      const newHolding: InvestmentHolding = {
        id: data.id,
        accountId: data.accountId,
        assetClass: data.assetClass as AssetClass,
        subType: (data.subType as FixedIncomeSubType) ?? undefined,
        ticker: data.ticker ?? undefined,
        name: data.name,
        currency: data.currency,
        currentQuantity: data.currentQuantity,
        averageCost: data.averageCost,
        totalInvested: data.totalInvested,
        isActive: data.isActive,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        holdings: [...state.holdings, newHolding],
        isLoading: false,
      }));

      return newHolding;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
      return null;
    }
  },

  updateHolding: async (id, input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-holdings'][':id'].$put({
        param: { id },
        json: input,
      });

      if (!res.ok) throw new Error('Failed to update investment holding');

      const data = await res.json();
      set((state) => ({
        holdings: state.holdings.map((h): InvestmentHolding =>
          h.id === id
            ? {
                ...h,
                name: data.name,
                ticker: data.ticker ?? undefined,
                assetClass: data.assetClass as AssetClass,
                subType: (data.subType as FixedIncomeSubType) ?? undefined,
                currency: data.currency,
                isActive: data.isActive,
                currentQuantity: data.currentQuantity,
                averageCost: data.averageCost,
                totalInvested: data.totalInvested,
                updatedAt: new Date(data.updatedAt),
              }
            : h
        ),
        isLoading: false,
      }));
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
      return false;
    }
  },

  deleteHolding: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-holdings'][':id'].$delete({
        param: { id },
      });

      if (!res.ok) throw new Error('Failed to delete investment holding');

      set((state) => ({
        holdings: state.holdings.filter((h) => h.id !== id),
        transactions: state.transactions.filter((t) => t.holdingId !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
    }
  },

  // ----------------------------------------
  // Transactions
  // ----------------------------------------
  fetchTransactions: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-transactions'].$get({
        query: {
          holdingId: filters?.holdingId,
          accountId: filters?.accountId,
          type: filters?.type,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch investment transactions');

      const data = await res.json();
      set({
        transactions: data.map((t) => ({
          id: t.id,
          holdingId: t.holdingId,
          type: t.type as InvestmentTransactionType,
          quantity: t.quantity ?? undefined,
          pricePerUnit: t.pricePerUnit ?? undefined,
          totalAmount: t.totalAmount,
          fees: t.fees,
          date: parseLocalDate(t.date),
          notes: t.notes ?? undefined,
          createdAt: new Date(t.createdAt),
          updatedAt: new Date(t.updatedAt),
          holding: t.holding
            ? {
                id: t.holding.id,
                name: t.holding.name,
                ticker: t.holding.ticker ?? undefined,
                assetClass: t.holding.assetClass as AssetClass,
              }
            : undefined,
        })),
        isLoading: false,
      });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
    }
  },

  addTransaction: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-transactions'].$post({
        json: {
          ...input,
          date: input.date instanceof Date ? input.date.toISOString() : input.date as string,
        },
      });

      if (!res.ok) throw new Error('Failed to create investment transaction');

      const data = await res.json();
      const newTx: InvestmentTransaction = {
        id: data.id,
        holdingId: data.holdingId,
        type: data.type as InvestmentTransactionType,
        quantity: data.quantity ?? undefined,
        pricePerUnit: data.pricePerUnit ?? undefined,
        totalAmount: data.totalAmount,
        fees: data.fees,
        date: parseLocalDate(data.date),
        notes: data.notes ?? undefined,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set({ isLoading: false });

      // Refresh all related data to get updated values (holdings, accounts,
      // and transactions with full holding info for display)
      get().fetchTransactions();
      get().fetchHoldings();
      get().fetchAccounts();

      return newTx;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
      return null;
    }
  },

  updateTransaction: async (id, input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-transactions'][':id'].$put({
        param: { id },
        json: {
          ...input,
          date: input.date instanceof Date ? input.date.toISOString() : input.date as string | undefined,
        },
      });

      if (!res.ok) throw new Error('Failed to update investment transaction');

      await res.json();
      set({ isLoading: false });

      // Refresh all related data to get updated values
      get().fetchTransactions();
      get().fetchHoldings();
      get().fetchAccounts();
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
      return false;
    }
  },

  deleteTransaction: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-transactions'][':id'].$delete({
        param: { id },
      });

      if (!res.ok) throw new Error('Failed to delete investment transaction');

      set({ isLoading: false });

      // Refresh all related data to get updated values
      get().fetchTransactions();
      get().fetchHoldings();
      get().fetchAccounts();
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
    }
  },

  // ----------------------------------------
  // Fund / Withdraw
  // ----------------------------------------
  fundAccount: async (accountId, input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-accounts'][':id'].fund.$post({
        param: { id: accountId },
        json: {
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
          date: input.date instanceof Date ? input.date.toISOString() : input.date as string,
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(
          (errorData as { error?: { message?: string } })?.error?.message
            || 'Failed to fund account'
        );
      }

      const data = await res.json();

      // Update local account cash balance
      set((state) => ({
        accounts: state.accounts.map((a) =>
          a.id === accountId ? { ...a, cashBalance: data.cashBalance } : a
        ),
        isLoading: false,
      }));

      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
      return false;
    }
  },

  withdrawAccount: async (accountId, input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['investment-accounts'][':id'].withdraw.$post({
        param: { id: accountId },
        json: {
          amount: input.amount,
          currency: input.currency,
          exchangeRate: input.exchangeRate,
          description: input.description,
          date: input.date instanceof Date ? input.date.toISOString() : input.date as string,
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => null);
        throw new Error(
          (errorData as { error?: { message?: string } })?.error?.message
            || 'Failed to withdraw from account'
        );
      }

      const data = await res.json();

      // Update local account cash balance
      set((state) => ({
        accounts: state.accounts.map((a) =>
          a.id === accountId ? { ...a, cashBalance: data.cashBalance } : a
        ),
        isLoading: false,
      }));

      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
      return false;
    }
  },

  // ----------------------------------------
  // Portfolio Summary
  // ----------------------------------------
  fetchPortfolioSummary: async () => {
    try {
      const res = await client.v1['investment-portfolio'].summary.$get();

      if (!res.ok) throw new Error('Failed to fetch portfolio summary');

      const data = await res.json();
      set({
        portfolioSummary: {
          totalInvested: data.totalInvested,
          totalByAssetClass: data.totalByAssetClass as Record<AssetClass, number>,
          holdingsCount: data.holdingsCount,
          accountsCount: data.accountsCount,
        },
      });
    } catch (error) {
      // Silent fail for summary - not critical
      console.error('Failed to fetch portfolio summary:', error);
    }
  },

  // ----------------------------------------
  // Utilities
  // ----------------------------------------
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  reset: () => set(initialState),
}));
