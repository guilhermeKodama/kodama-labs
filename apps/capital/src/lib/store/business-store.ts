import { create } from 'zustand';
import type { Business, CreateBusinessInput, UpdateBusinessInput } from '@/types';
import { client } from '@/lib/api-client';

interface BusinessState {
  businesses: Business[];
  isLoading: boolean;
  error: string | null;
}

interface BusinessActions {
  fetchBusinesses: () => Promise<void>;
  addBusiness: (input: CreateBusinessInput) => Promise<Business | null>;
  updateBusiness: (id: string, input: UpdateBusinessInput) => Promise<void>;
  deleteBusiness: (id: string) => Promise<void>;
  getBusiness: (id: string) => Business | undefined;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  reset: () => void;
}

type BusinessStore = BusinessState & BusinessActions;

export const useBusinessStore = create<BusinessStore>()((set, get) => ({
  // State
  businesses: [],
  isLoading: false,
  error: null,

  // Fetch businesses from API (userId is now taken from session on the backend)
  fetchBusinesses: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.businesses.$get();

      if (!res.ok) {
        throw new Error('Failed to fetch businesses');
      }

      const data = await res.json();
      set({
        businesses: data.map((b) => ({
          id: b.id,
          userId: b.userId,
          name: b.name,
          description: b.description ?? undefined,
          defaultCurrency: b.defaultCurrency,
          color: b.color ?? undefined,
          createdAt: new Date(b.createdAt),
          updatedAt: new Date(b.updatedAt),
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

  // Create business via API (userId is now taken from session on the backend)
  addBusiness: async (input: CreateBusinessInput) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.businesses.$post({
        json: {
          name: input.name,
          description: input.description,
          defaultCurrency: input.defaultCurrency,
          color: input.color,
        },
      });

      if (!res.ok) {
        throw new Error('Failed to create business');
      }

      const data = await res.json();
      const newBusiness: Business = {
        id: data.id,
        userId: data.userId,
        name: data.name,
        description: data.description ?? undefined,
        defaultCurrency: data.defaultCurrency,
        color: data.color ?? undefined,
        createdAt: new Date(data.createdAt),
        updatedAt: new Date(data.updatedAt),
      };

      set((state) => ({
        businesses: [...state.businesses, newBusiness],
        isLoading: false,
      }));

      return newBusiness;
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
      return null;
    }
  },

  // Update business via API
  updateBusiness: async (id: string, input: UpdateBusinessInput) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.businesses[':id'].$put({
        param: { id },
        json: input,
      });

      if (!res.ok) {
        throw new Error('Failed to update business');
      }

      const data = await res.json();
      set((state) => ({
        businesses: state.businesses.map((business) =>
          business.id === id
            ? {
                id: data.id,
                userId: data.userId,
                name: data.name,
                description: data.description ?? undefined,
                defaultCurrency: data.defaultCurrency,
                color: data.color ?? undefined,
                createdAt: new Date(data.createdAt),
                updatedAt: new Date(data.updatedAt),
              }
            : business
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

  // Delete business via API
  deleteBusiness: async (id: string) => {
    set({ isLoading: true, error: null });
    try {
      const res = await client.v1.businesses[':id'].$delete({
        param: { id },
      });

      if (!res.ok) {
        throw new Error('Failed to delete business');
      }

      set((state) => ({
        businesses: state.businesses.filter((business) => business.id !== id),
        isLoading: false,
      }));
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : 'Unknown error',
        isLoading: false,
      });
    }
  },

  getBusiness: (id) => {
    return get().businesses.find((business) => business.id === id);
  },

  setLoading: (loading) => set({ isLoading: loading }),
  setError: (error) => set({ error }),
  
  reset: () => {
    set({
      businesses: [],
      isLoading: false,
      error: null,
    });
  },
}));
