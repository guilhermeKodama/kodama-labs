import { create } from 'zustand';
import { parseLocalDate } from '@/lib/utils/date';
import type {
  CreditCard,
  CreateCreditCardInput,
  UpdateCreditCardInput,
  CreditCardBill,
  BillTransaction,
  Installment,
  BillUploadResult,
  BillStatus,
  CategorizationStatus,
} from '@/types';
import { client } from '@/lib/api-client';

interface CreditCardState {
  creditCards: CreditCard[];
  bills: CreditCardBill[];
  billTransactions: BillTransaction[];
  allBillTransactions: BillTransaction[];
  installments: Installment[];
  isLoading: boolean;
  error: string | null;
}

interface CreditCardActions {
  // Credit Card CRUD
  fetchCreditCards: (filters?: {
    businessId?: string;
    personalAccountId?: string;
    entityType?: 'business' | 'personal';
    isActive?: boolean;
  }) => Promise<void>;
  addCreditCard: (input: CreateCreditCardInput) => Promise<CreditCard | null>;
  updateCreditCard: (id: string, input: UpdateCreditCardInput) => Promise<void>;
  deleteCreditCard: (id: string) => Promise<void>;

  // Bills
  fetchBills: (filters?: {
    creditCardId?: string;
    status?: BillStatus;
  }) => Promise<void>;
  uploadBill: (data: {
    creditCardId: string;
    closingDate: string;
    dueDate: string;
    csvContent: string;
    csvFileName: string;
    transactionId?: string;
  }) => Promise<BillUploadResult | null>;
  createBillExpense: (data: {
    billId: string;
    entityType: 'business' | 'personal';
    businessId?: string;
    personalAccountId?: string;
    currency: string;
    exchangeRate?: number;
    date: string;
  }) => Promise<void>;

  // Link bill to existing transaction
  linkBillToTransaction: (billId: string, transactionId: string) => Promise<void>;

  // Update bill's own closingDate/dueDate
  updateBill: (id: string, data: { closingDate?: string; dueDate?: string }) => Promise<void>;

  // Delete bill
  deleteBill: (id: string) => Promise<void>;

  // Bill Transactions
  fetchBillTransactions: (billId: string) => Promise<void>;
  fetchAllBillTransactions: () => Promise<void>;
  updateBillTransactionCategory: (id: string, category: string) => Promise<void>;

  // Installments
  fetchInstallments: (filters?: {
    creditCardId?: string;
    isActive?: boolean;
  }) => Promise<void>;

  // Utils
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type CreditCardStore = CreditCardState & CreditCardActions;

export const useCreditCardStore = create<CreditCardStore>()((set, get) => ({
  // State
  creditCards: [],
  bills: [],
  billTransactions: [],
  allBillTransactions: [],
  installments: [],
  isLoading: false,
  error: null,

  // Fetch credit cards
  fetchCreditCards: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].$get({
        query: {
          businessId: filters?.businessId,
          personalAccountId: filters?.personalAccountId,
          entityType: filters?.entityType,
          isActive: filters?.isActive,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch credit cards');

      const data = await res.json();
      set({
        creditCards: data.map((card) => ({
          id: card.id,
          entityId: card.businessId ?? card.personalAccountId ?? '',
          entityType: card.entityType,
          bankName: card.bankName,
          lastFourDigits: card.lastFourDigits,
          nickname: card.nickname ?? undefined,
          creditLimit: card.creditLimit,
          closingDay: card.closingDay,
          dueDay: card.dueDay,
          color: card.color,
          currency: card.currency,
          isActive: card.isActive,
          createdAt: new Date(card.createdAt),
          updatedAt: new Date(card.updatedAt),
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

  // Create credit card
  addCreditCard: async (input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].$post({
        json: input,
      });

      if (!res.ok) throw new Error('Failed to create credit card');

      const data = await res.json();
      const newCard: CreditCard = {
        id: data.id,
        entityId: data.businessId ?? data.personalAccountId ?? '',
        entityType: data.entityType,
        bankName: data.bankName,
        lastFourDigits: data.lastFourDigits,
        nickname: data.nickname ?? undefined,
        creditLimit: data.creditLimit,
        closingDay: data.closingDay,
        dueDay: data.dueDay,
        color: data.color,
        currency: data.currency,
        isActive: data.isActive,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        creditCards: [...state.creditCards, newCard],
        isLoading: false,
      }));

      return newCard;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  // Update credit card
  updateCreditCard: async (id, input) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'][':id'].$put({
        param: { id },
        json: input,
      });

      if (!res.ok) throw new Error('Failed to update credit card');

      const data = await res.json();
      set((state) => ({
        creditCards: state.creditCards.map((card) =>
          card.id === id
            ? {
                ...card,
                bankName: data.bankName,
                lastFourDigits: data.lastFourDigits,
                nickname: data.nickname ?? undefined,
                creditLimit: data.creditLimit,
                closingDay: data.closingDay,
                dueDay: data.dueDay,
                color: data.color,
                currency: data.currency,
                isActive: data.isActive,
                updatedAt: new Date(data.updatedAt),
              }
            : card
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

  // Delete credit card
  deleteCreditCard: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'][':id'].$delete({
        param: { id },
      });

      if (!res.ok) throw new Error('Failed to delete credit card');

      set((state) => ({
        creditCards: state.creditCards.filter((c) => c.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Fetch bills
  fetchBills: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].bills.$get({
        query: {
          creditCardId: filters?.creditCardId,
          status: filters?.status,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch bills');

      const data = await res.json();
      set({
        bills: data.map((bill) => ({
          id: bill.id,
          creditCardId: bill.creditCardId,
          transactionId: bill.transactionId ?? undefined,
          closingDate: parseLocalDate(bill.closingDate),
          dueDate: parseLocalDate(bill.dueDate),
          totalAmount: bill.totalAmount,
          status: bill.status as BillStatus,
          categorizationStatus: (bill.categorizationStatus as CategorizationStatus) ?? 'completed',
          csvFileName: bill.csvFileName ?? undefined,
          creditCard: bill.creditCard
            ? {
                id: bill.creditCard.id,
                bankName: bill.creditCard.bankName,
                lastFourDigits: bill.creditCard.lastFourDigits,
                nickname: bill.creditCard.nickname ?? undefined,
                color: bill.creditCard.color,
              }
            : undefined,
          transactionCount: bill.transactionCount,
          createdAt: new Date(bill.createdAt),
          updatedAt: new Date(bill.updatedAt),
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

  // Upload bill CSV
  uploadBill: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].bills.upload.$post({
        json: data,
      });

      if (!res.ok) throw new Error('Failed to upload bill');

      const result = await res.json();

      // Refresh bills after upload
      await get().fetchBills();
      await get().fetchInstallments();

      set({ isLoading: false });

      return {
        bill: {
          id: result.bill.id,
          creditCardId: result.bill.creditCardId,
          closingDate: parseLocalDate(result.bill.closingDate),
          dueDate: parseLocalDate(result.bill.dueDate),
          totalAmount: result.bill.totalAmount,
          status: result.bill.status as BillStatus,
          categorizationStatus: (result.bill.categorizationStatus as CategorizationStatus) ?? 'pending',
        },
        totalAmount: result.totalAmount,
        transactionCount: result.transactionCount,
        replaced: result.replaced,
      };
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  // Link bill to existing transaction
  linkBillToTransaction: async (billId, transactionId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].bills[':id'].link.$put({
        param: { id: billId },
        json: { transactionId },
      });

      if (!res.ok) throw new Error('Failed to link bill to transaction');

      // Refresh bills to get updated status
      await get().fetchBills();
      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Update bill's own closingDate/dueDate
  updateBill: async (id, data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].bills[':id'].$put({
        param: { id },
        json: data,
      });

      if (!res.ok) throw new Error('Failed to update bill');

      const updated = await res.json();
      set((state) => ({
        bills: state.bills.map((bill) =>
          bill.id === id
            ? {
                ...bill,
                closingDate: parseLocalDate(updated.closingDate),
                dueDate: parseLocalDate(updated.dueDate),
              }
            : bill
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

  // Delete bill
  deleteBill: async (id) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].bills[':id'].$delete({
        param: { id },
      });

      if (!res.ok) throw new Error('Failed to delete bill');

      set((state) => ({
        bills: state.bills.filter((b) => b.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Create expense from bill
  createBillExpense: async (data) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].bills.expense.$post({
        json: data,
      });

      if (!res.ok) throw new Error('Failed to create expense from bill');

      // Refresh bills to update transaction link
      await get().fetchBills();

      set({ isLoading: false });
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Fetch bill transactions
  // Update bill transaction category
  updateBillTransactionCategory: async (id, category) => {
    try {
      const res = await client.v1['credit-cards'].bills.transactions[':id'].$put({
        param: { id },
        json: { category },
      });

      if (!res.ok) throw new Error('Failed to update category');

      const data = await res.json();
      set((state) => ({
        billTransactions: state.billTransactions.map((t) =>
          t.id === id
            ? { ...t, category: data.category, isAutoCategorized: data.isAutoCategorized }
            : t
        ),
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  },

  fetchBillTransactions: async (billId) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].bills[':billId'].transactions.$get({
        param: { billId },
      });

      if (!res.ok) throw new Error('Failed to fetch bill transactions');

      const data = await res.json();
      set({
        billTransactions: data.map((t) => ({
          id: t.id,
          billId: t.billId,
          category: t.category,
          transactionDate: parseLocalDate(t.transactionDate),
          description: t.description,
          merchantName: t.merchantName ?? undefined,
          amount: t.amount,
          installmentNumber: t.installmentNumber ?? undefined,
          totalInstallments: t.totalInstallments ?? undefined,
          isAutoCategorized: t.isAutoCategorized,
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

  // Fetch all bill transactions across all bills (for budget integration)
  fetchAllBillTransactions: async () => {
    const bills = get().bills;
    if (bills.length === 0) {
      set({ allBillTransactions: [] });
      return;
    }

    try {
      const allTxs: BillTransaction[] = [];
      for (const bill of bills) {
        const res = await client.v1['credit-cards'].bills[':billId'].transactions.$get({
          param: { billId: bill.id },
        });
        if (!res.ok) continue;
        const data = await res.json();
        allTxs.push(
          ...data.map((t) => ({
            id: t.id,
            billId: t.billId,
            category: t.category,
            transactionDate: parseLocalDate(t.transactionDate),
            description: t.description,
            merchantName: t.merchantName ?? undefined,
            amount: t.amount,
            installmentNumber: t.installmentNumber ?? undefined,
            totalInstallments: t.totalInstallments ?? undefined,
            isAutoCategorized: t.isAutoCategorized,
            createdAt: new Date(t.createdAt),
            updatedAt: new Date(t.updatedAt),
          }))
        );
      }
      set({ allBillTransactions: allTxs });
    } catch (error) {
      console.error('Failed to fetch all bill transactions:', error);
    }
  },

  // Fetch installments
  fetchInstallments: async (filters) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1['credit-cards'].installments.$get({
        query: {
          creditCardId: filters?.creditCardId,
          isActive: filters?.isActive,
        },
      });

      if (!res.ok) throw new Error('Failed to fetch installments');

      const data = await res.json();
      set({
        installments: data.map((inst) => ({
          id: inst.id,
          creditCardId: inst.creditCardId,
          billTransactionId: inst.billTransactionId,
          description: inst.description,
          category: (inst as Record<string, unknown>).category as string | undefined,
          totalAmount: inst.totalAmount,
          totalInstallments: inst.totalInstallments,
          paidInstallments: inst.paidInstallments,
          remainingInstallments: inst.remainingInstallments,
          startDate: parseLocalDate(inst.startDate),
          installmentAmount: inst.installmentAmount,
          isActive: inst.isActive,
          creditCard: inst.creditCard
            ? {
                id: inst.creditCard.id,
                bankName: inst.creditCard.bankName,
                lastFourDigits: inst.creditCard.lastFourDigits,
                nickname: inst.creditCard.nickname ?? undefined,
                color: inst.creditCard.color,
              }
            : undefined,
          createdAt: new Date(inst.createdAt),
          updatedAt: new Date(inst.updatedAt),
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

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),

  reset: () => {
    set({
      creditCards: [],
      bills: [],
      billTransactions: [],
      allBillTransactions: [],
      installments: [],
      isLoading: false,
      error: null,
    });
  },
}));
