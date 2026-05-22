import { create } from 'zustand';
import type {
  Attachment,
  AttachmentOwnerType,
} from '@/components/attachments/attachment-uploader';

type ApiAttachment = Attachment & {
  transactionId: string | null;
  transferId: string | null;
  recurringTransactionId: string | null;
  recurringTransferId: string | null;
};

const OWNER_ID_FIELD: Record<AttachmentOwnerType, keyof Pick<
  ApiAttachment,
  'transactionId' | 'transferId' | 'recurringTransactionId' | 'recurringTransferId'
>> = {
  transaction: 'transactionId',
  transfer: 'transferId',
  recurringTransaction: 'recurringTransactionId',
  recurringTransfer: 'recurringTransferId',
};

interface AttachmentState {
  byOwner: Record<AttachmentOwnerType, Record<string, Attachment[]>>;
  loadedTypes: Partial<Record<AttachmentOwnerType, boolean>>;
}

interface AttachmentActions {
  fetchByOwnerType: (ownerType: AttachmentOwnerType) => Promise<void>;
  setForOwner: (
    ownerType: AttachmentOwnerType,
    ownerId: string,
    attachments: Attachment[],
  ) => void;
  getForOwner: (
    ownerType: AttachmentOwnerType,
    ownerId: string,
  ) => Attachment[];
  reset: () => void;
}

const emptyByOwner: AttachmentState['byOwner'] = {
  transaction: {},
  transfer: {},
  recurringTransaction: {},
  recurringTransfer: {},
};

export const useAttachmentStore = create<AttachmentState & AttachmentActions>()(
  (set, get) => ({
    byOwner: emptyByOwner,
    loadedTypes: {},

    fetchByOwnerType: async (ownerType) => {
      try {
        const params = new URLSearchParams({ ownerType });
        const res = await fetch(`/api/v1/attachments?${params.toString()}`, {
          credentials: 'include',
        });
        if (!res.ok) return;
        const data = (await res.json()) as ApiAttachment[];
        const idField = OWNER_ID_FIELD[ownerType];
        const grouped: Record<string, Attachment[]> = {};
        for (const a of data) {
          const ownerId = a[idField];
          if (!ownerId) continue;
          if (!grouped[ownerId]) grouped[ownerId] = [];
          grouped[ownerId].push({
            id: a.id,
            kind: a.kind,
            blobUrl: a.blobUrl,
            mimeType: a.mimeType,
            sizeBytes: a.sizeBytes,
            originalName: a.originalName,
            uploadedAt: a.uploadedAt,
          });
        }
        set((state) => ({
          byOwner: { ...state.byOwner, [ownerType]: grouped },
          loadedTypes: { ...state.loadedTypes, [ownerType]: true },
        }));
      } catch {
        // Silent — row indicators are best-effort
      }
    },

    setForOwner: (ownerType, ownerId, attachments) => {
      set((state) => ({
        byOwner: {
          ...state.byOwner,
          [ownerType]: {
            ...state.byOwner[ownerType],
            [ownerId]: attachments,
          },
        },
      }));
    },

    getForOwner: (ownerType, ownerId) => {
      return get().byOwner[ownerType][ownerId] ?? [];
    },

    reset: () => set({ byOwner: emptyByOwner, loadedTypes: {} }),
  }),
);
