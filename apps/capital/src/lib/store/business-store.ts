import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Business, CreateBusinessInput, UpdateBusinessInput } from '@/types';

interface BusinessState {
  businesses: Business[];
  isLoading: boolean;
  error: string | null;
}

interface BusinessActions {
  addBusiness: (input: CreateBusinessInput) => Business;
  updateBusiness: (id: string, input: UpdateBusinessInput) => void;
  deleteBusiness: (id: string) => void;
  getBusiness: (id: string) => Business | undefined;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
}

type BusinessStore = BusinessState & BusinessActions;

const generateId = () => crypto.randomUUID();

export const useBusinessStore = create<BusinessStore>()(
  persist(
    (set, get) => ({
      // State
      businesses: [],
      isLoading: false,
      error: null,

      // Actions
      addBusiness: (input) => {
        const newBusiness: Business = {
          id: generateId(),
          userId: 'default-user', // Will be replaced with actual user ID
          name: input.name,
          description: input.description,
          defaultCurrency: input.defaultCurrency,
          color: input.color,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

        set((state) => ({
          businesses: [...state.businesses, newBusiness],
        }));

        return newBusiness;
      },

      updateBusiness: (id, input) => {
        set((state) => ({
          businesses: state.businesses.map((business) =>
            business.id === id
              ? { ...business, ...input, updatedAt: new Date() }
              : business
          ),
        }));
      },

      deleteBusiness: (id) => {
        set((state) => ({
          businesses: state.businesses.filter((business) => business.id !== id),
        }));
      },

      getBusiness: (id) => {
        return get().businesses.find((business) => business.id === id);
      },

      setLoading: (loading) => set({ isLoading: loading }),
      setError: (error) => set({ error }),
    }),
    {
      name: 'capital-businesses',
      partialize: (state) => ({ businesses: state.businesses }),
    }
  )
);
