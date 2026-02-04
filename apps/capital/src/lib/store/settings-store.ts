import { create } from 'zustand';
import type {
  AppSettings,
  Currency,
  Category,
  PersonalAccount,
  CreateCurrencyInput,
  TransactionType,
  TaxSettings,
} from '@/types';
import { client } from '@/lib/api-client';

interface SettingsState {
  settings: AppSettings;
  currencies: Currency[];
  categories: Category[];
  personalAccount: PersonalAccount | null;
  taxSettings: TaxSettings;
  isInitialized: boolean;
  isLoading: boolean;
  error: string | null;
}

interface SettingsActions {
  // Fetch actions
  fetchUserData: (userId: string) => Promise<void>;
  fetchCategories: (userId: string) => Promise<void>;
  fetchCurrencies: (userId: string) => Promise<void>;
  
  // Mutation actions
  updateSettings: (settings: Partial<AppSettings>) => Promise<void>;
  addCurrency: (input: CreateCurrencyInput) => Promise<void>;
  updateCurrencyRate: (code: string, rate: number) => Promise<void>;
  removeCurrency: (code: string) => Promise<void>;
  addCategory: (name: string, type: TransactionType, color?: string) => Promise<void>;
  removeCategory: (id: string) => Promise<void>;
  
  // Tax settings (local for now - could be moved to API later)
  updateTaxSettings: (settings: Partial<TaxSettings>) => void;
  setEntityTaxRate: (entityId: string, rate: number) => void;
  
  // App management
  initializeApp: (baseCurrency: string, name: string) => Promise<void>;
  resetApp: () => void;
  
  // State setters
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type SettingsStore = SettingsState & SettingsActions;

const defaultSettings: AppSettings = {
  userId: '',
  baseCurrency: 'USD',
  theme: 'system',
  dateFormat: 'MMM d, yyyy',
  numberFormat: 'en-US',
};

const defaultTaxSettings: TaxSettings = {
  taxYear: new Date().getFullYear(),
  entityTaxRates: {},
};

export const useSettingsStore = create<SettingsStore>()((set, get) => ({
  // State
  settings: defaultSettings,
  currencies: [],
  categories: [],
  personalAccount: null,
  taxSettings: defaultTaxSettings,
  isInitialized: false,
  isLoading: false,
  error: null,

  // Fetch user data from API
  fetchUserData: async (userId: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.users[':userId'].$get({
        param: { userId },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch user');
      }

      const userData = await res.json();
      
      set({
        settings: {
          userId: userData.id,
          baseCurrency: userData.baseCurrency,
          theme: userData.theme as 'light' | 'dark' | 'system',
          dateFormat: userData.dateFormat,
          numberFormat: userData.numberFormat as 'en-US' | 'pt-BR' | 'de-DE',
        },
        personalAccount: userData.personalAccount
          ? {
              id: userData.personalAccount.id,
              userId: userData.id,
              defaultCurrency: userData.personalAccount.defaultCurrency,
              createdAt: new Date(userData.createdAt),
              updatedAt: new Date(userData.updatedAt),
            }
          : null,
        isInitialized: true,
        isLoading: false,
      });

      // Also fetch categories and currencies
      await Promise.all([
        get().fetchCategories(userId),
        get().fetchCurrencies(userId),
      ]);
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Fetch categories from API
  fetchCategories: async (userId: string) => {
    try {
      const res = await client.v1.categories.$get({
        query: { userId },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch categories');
      }

      const data = await res.json();
      set({
        categories: data.map((cat) => ({
          id: cat.id,
          name: cat.name,
          type: cat.type,
          color: cat.color ?? undefined,
          icon: cat.icon ?? undefined,
        })),
      });
    } catch (error) {
      console.error('Failed to fetch categories:', error);
    }
  },

  // Fetch currencies from API
  fetchCurrencies: async (userId: string) => {
    try {
      const res = await client.v1.currencies.$get({
        query: { userId },
      });

      if (!res.ok) {
        throw new Error('Failed to fetch currencies');
      }

      const data = await res.json();
      set({
        currencies: data.map((cur) => ({
          code: cur.code,
          name: cur.name,
          symbol: cur.symbol,
          manualRate: cur.manualRate,
          updatedAt: new Date(cur.updatedAt),
        })),
      });
    } catch (error) {
      console.error('Failed to fetch currencies:', error);
    }
  },

  // Update user settings via API
  updateSettings: async (newSettings: Partial<AppSettings>) => {
    const { settings } = get();
    if (!settings.userId) return;
    
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.users[':userId'].$put({
        param: { userId: settings.userId },
        json: {
          name: undefined, // Optional
          baseCurrency: newSettings.baseCurrency,
          theme: newSettings.theme,
          dateFormat: newSettings.dateFormat,
          numberFormat: newSettings.numberFormat,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to update settings');
      }

      const userData = await res.json();
      set((state) => ({
        settings: {
          ...state.settings,
          baseCurrency: userData.baseCurrency,
          theme: userData.theme as 'light' | 'dark' | 'system',
          dateFormat: userData.dateFormat,
          numberFormat: userData.numberFormat as 'en-US' | 'pt-BR' | 'de-DE',
        },
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Add currency via API
  addCurrency: async (input: CreateCurrencyInput) => {
    const { settings } = get();
    if (!settings.userId) return;
    
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.currencies.$post({
        json: {
          userId: settings.userId,
          code: input.code,
          name: input.name,
          symbol: input.symbol,
          manualRate: input.manualRate,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to add currency');
      }

      const data = await res.json();
      const newCurrency: Currency = {
        code: data.code,
        name: data.name,
        symbol: data.symbol,
        manualRate: data.manualRate,
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        currencies: [...state.currencies, newCurrency],
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Update currency rate via API
  updateCurrencyRate: async (code: string, rate: number) => {
    const { settings } = get();
    if (!settings.userId) return;
    
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.currencies[':code'].$put({
        param: { code },
        json: { userId: settings.userId, manualRate: rate },
      });

      if (!res.ok) {
        throw new Error('Failed to update currency rate');
      }

      const data = await res.json();
      set((state) => ({
        currencies: state.currencies.map((currency) =>
          currency.code === code
            ? { ...currency, manualRate: data.manualRate, updatedAt: new Date(data.updatedAt) }
            : currency
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

  // Remove currency via API
  removeCurrency: async (code: string) => {
    const { settings } = get();
    if (!settings.userId) return;
    
    // Don't allow removing base currency
    if (code === settings.baseCurrency) return;

    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.currencies[':code'].$delete({
        param: { code },
        query: { userId: settings.userId },
      });

      if (!res.ok) {
        throw new Error('Failed to remove currency');
      }

      set((state) => ({
        currencies: state.currencies.filter((c) => c.code !== code),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Add category via API
  addCategory: async (name: string, type: TransactionType, color?: string) => {
    const { settings } = get();
    if (!settings.userId) return;
    
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.categories.$post({
        json: {
          userId: settings.userId,
          name,
          type,
          color,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to add category');
      }

      const data = await res.json();
      const newCategory: Category = {
        id: data.id,
        name: data.name,
        type: data.type,
        color: data.color ?? undefined,
        icon: data.icon ?? undefined,
      };

      set((state) => ({
        categories: [...state.categories, newCategory],
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Remove category via API
  removeCategory: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.categories[':id'].$delete({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to remove category');
      }

      set((state) => ({
        categories: state.categories.filter((c) => c.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Tax settings (local for now)
  updateTaxSettings: (newTaxSettings) => {
    set((state) => ({
      taxSettings: { ...state.taxSettings, ...newTaxSettings },
    }));
  },

  setEntityTaxRate: (entityId, rate) => {
    set((state) => ({
      taxSettings: {
        ...state.taxSettings,
        entityTaxRates: {
          ...state.taxSettings.entityTaxRates,
          [entityId]: rate,
        },
      },
    }));
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  
  // Initialize app - called during onboarding to set user preferences
  initializeApp: async (baseCurrency: string, name: string) => {
    const { settings } = get();
    if (!settings.userId) return;
    
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.users[':userId'].$put({
        param: { userId: settings.userId },
        json: {
          name,
          baseCurrency,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to initialize app');
      }

      const userData = await res.json();
      set((state) => ({
        settings: {
          ...state.settings,
          baseCurrency: userData.baseCurrency,
        },
        isInitialized: true,
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  // Reset app - clears local storage and resets state
  resetApp: () => {
    // Clear localStorage
    if (typeof window !== 'undefined') {
      localStorage.removeItem('capital-demo-user-id');
    }
    
    set({
      settings: defaultSettings,
      currencies: [],
      categories: [],
      personalAccount: null,
      taxSettings: defaultTaxSettings,
      isInitialized: false,
      isLoading: false,
      error: null,
    });
  },
  
  reset: () => {
    set({
      settings: defaultSettings,
      currencies: [],
      categories: [],
      personalAccount: null,
      taxSettings: defaultTaxSettings,
      isInitialized: false,
      isLoading: false,
      error: null,
    });
  },
}));
