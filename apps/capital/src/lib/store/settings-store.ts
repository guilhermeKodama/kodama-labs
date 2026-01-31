import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AppSettings,
  Currency,
  Category,
  PersonalAccount,
  CreateCurrencyInput,
  TransactionType,
} from '@/types';
import {
  DEFAULT_INCOME_CATEGORIES,
  DEFAULT_EXPENSE_CATEGORIES,
  DEFAULT_INVESTMENT_CATEGORIES,
} from '@/types';
import { getDefaultCurrencies } from '@/lib/utils/currency';

interface SettingsState {
  settings: AppSettings;
  currencies: Currency[];
  categories: Category[];
  personalAccount: PersonalAccount | null;
  isInitialized: boolean;
}

interface SettingsActions {
  updateSettings: (settings: Partial<AppSettings>) => void;
  addCurrency: (input: CreateCurrencyInput) => void;
  updateCurrencyRate: (code: string, rate: number) => void;
  removeCurrency: (code: string) => void;
  addCategory: (name: string, type: TransactionType, color?: string) => void;
  removeCategory: (id: string) => void;
  initializePersonalAccount: () => void;
  initializeApp: (baseCurrency: string, userName: string) => void;
  resetApp: () => void;
}

type SettingsStore = SettingsState & SettingsActions;

const generateId = () => crypto.randomUUID();

const createDefaultCategories = (): Category[] => {
  const categories: Category[] = [];

  DEFAULT_INCOME_CATEGORIES.forEach((name) => {
    categories.push({
      id: generateId(),
      name,
      type: 'income',
    });
  });

  DEFAULT_EXPENSE_CATEGORIES.forEach((name) => {
    categories.push({
      id: generateId(),
      name,
      type: 'expense',
    });
  });

  DEFAULT_INVESTMENT_CATEGORIES.forEach((name) => {
    categories.push({
      id: generateId(),
      name,
      type: 'investment',
    });
  });

  return categories;
};

const defaultSettings: AppSettings = {
  userId: '',
  baseCurrency: 'USD',
  theme: 'system',
  dateFormat: 'MMM d, yyyy',
  numberFormat: 'en-US',
};

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set, get) => ({
      // State
      settings: defaultSettings,
      currencies: [],
      categories: [],
      personalAccount: null,
      isInitialized: false,

      // Actions
      updateSettings: (newSettings) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },

      addCurrency: (input) => {
        const newCurrency: Currency = {
          code: input.code,
          name: input.name,
          symbol: input.symbol,
          manualRate: input.manualRate,
          updatedAt: new Date(),
        };

        set((state) => ({
          currencies: [...state.currencies, newCurrency],
        }));
      },

      updateCurrencyRate: (code, rate) => {
        set((state) => ({
          currencies: state.currencies.map((currency) =>
            currency.code === code
              ? { ...currency, manualRate: rate, updatedAt: new Date() }
              : currency
          ),
        }));
      },

      removeCurrency: (code) => {
        const { settings } = get();
        // Don't allow removing base currency
        if (code === settings.baseCurrency) return;

        set((state) => ({
          currencies: state.currencies.filter((c) => c.code !== code),
        }));
      },

      addCategory: (name, type, color) => {
        const newCategory: Category = {
          id: generateId(),
          name,
          type,
          color,
        };

        set((state) => ({
          categories: [...state.categories, newCategory],
        }));
      },

      removeCategory: (id) => {
        set((state) => ({
          categories: state.categories.filter((c) => c.id !== id),
        }));
      },

      initializePersonalAccount: () => {
        const { settings, personalAccount } = get();
        if (personalAccount) return;

        const newPersonalAccount: PersonalAccount = {
          id: generateId(),
          userId: settings.userId,
          defaultCurrency: settings.baseCurrency,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        set({ personalAccount: newPersonalAccount });
      },

      initializeApp: (baseCurrency, userName) => {
        const userId = generateId();

        const settings: AppSettings = {
          ...defaultSettings,
          userId,
          baseCurrency,
        };

        const personalAccount: PersonalAccount = {
          id: generateId(),
          userId,
          defaultCurrency: baseCurrency,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        const currencies = getDefaultCurrencies(baseCurrency);
        const categories = createDefaultCategories();

        set({
          settings,
          currencies,
          categories,
          personalAccount,
          isInitialized: true,
        });
      },

      resetApp: () => {
        set({
          settings: defaultSettings,
          currencies: [],
          categories: [],
          personalAccount: null,
          isInitialized: false,
        });
      },
    }),
    {
      name: 'capital-settings',
      partialize: (state) => ({
        settings: state.settings,
        currencies: state.currencies,
        categories: state.categories,
        personalAccount: state.personalAccount,
        isInitialized: state.isInitialized,
      }),
    }
  )
);
