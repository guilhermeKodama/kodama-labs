export interface WallexRecord {
  id?: number;
  userId: string;
  title: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
  timestamp: string;
  synced: boolean;
}

export interface WallexSubmission {
  userId: string;
  title: string;
  description: string;
  category: string;
  amount: number;
  currency: string;
}

export interface SyncResponse {
  success: boolean;
  message: string;
  recordId?: number;
}

export interface SyncResult {
  success: boolean;
  syncedCount: number;
  failedCount: number;
  errors: string[];
}
