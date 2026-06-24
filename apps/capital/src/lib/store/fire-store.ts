import { create } from 'zustand';
import { client } from '@/lib/api-client';
import type {
  FireSummaryResponse,
  FireGoalInput,
  FireGoalResponse,
  FireSnapshotResponse,
} from '@capital/server/modules/fire/validations/fire';

// Re-export the server-inferred shapes so components have one source of truth.
export type {
  FireSummaryResponse,
  FireGoalInput,
  FireGoalResponse,
  FireSnapshotResponse,
  MilestoneInput,
} from '@capital/server/modules/fire/validations/fire';

interface FireState {
  summary: FireSummaryResponse | null;
  isLoading: boolean;
  isSaving: boolean;
  error: string | null;
}

interface FireActions {
  fetchSummary: () => Promise<void>;
  saveGoal: (input: FireGoalInput) => Promise<FireGoalResponse | null>;
  recordSnapshot: () => Promise<FireSnapshotResponse | null>;
  upsertSnapshot: (
    period: number,
    input: { currentInvested: number; currentMonthlyExpenses?: number }
  ) => Promise<FireSnapshotResponse | null>;
  deleteSnapshot: (period: number) => Promise<boolean>;
  reset: () => void;
}

const initialState: FireState = {
  summary: null,
  isLoading: false,
  isSaving: false,
  error: null,
};

export const useFireStore = create<FireState & FireActions>()((set, get) => ({
  ...initialState,

  fetchSummary: async () => {
    set({ isLoading: true, error: null });
    try {
      // no-store: a PUT to /goal doesn't invalidate the browser cache for the
      // /summary GET, so without this a re-fetch after saving can return stale.
      const res = await client.v1.fire.summary.$get(undefined, {
        init: { cache: 'no-store' },
      });
      if (!res.ok) throw new Error('Failed to fetch FIRE summary');
      const summary = (await res.json()) as FireSummaryResponse;
      set({ summary, isLoading: false });
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isLoading: false });
    }
  },

  saveGoal: async (input) => {
    set({ isSaving: true, error: null });
    try {
      const res = await client.v1.fire.goal.$put({ json: input });
      if (!res.ok) throw new Error('Failed to save FIRE plan');
      const goal = (await res.json()) as FireGoalResponse;
      set({ isSaving: false });
      // Re-derive the whole summary against the new plan.
      await get().fetchSummary();
      return goal;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error', isSaving: false });
      return null;
    }
  },

  recordSnapshot: async () => {
    try {
      const res = await client.v1.fire.snapshot.$post();
      if (!res.ok) throw new Error('Failed to record snapshot');
      const snapshot = (await res.json()) as FireSnapshotResponse;
      await get().fetchSummary();
      return snapshot;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return null;
    }
  },

  upsertSnapshot: async (period, input) => {
    try {
      const res = await client.v1.fire.snapshots[':period'].$put({
        param: { period },
        json: input,
      });
      if (!res.ok) throw new Error('Failed to save snapshot');
      const snapshot = (await res.json()) as FireSnapshotResponse;
      await get().fetchSummary();
      return snapshot;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return null;
    }
  },

  deleteSnapshot: async (period) => {
    try {
      const res = await client.v1.fire.snapshots[':period'].$delete({
        param: { period },
      });
      if (!res.ok) throw new Error('Failed to delete snapshot');
      await get().fetchSummary();
      return true;
    } catch (error) {
      set({ error: error instanceof Error ? error.message : 'Unknown error' });
      return false;
    }
  },

  reset: () => set(initialState),
}));
