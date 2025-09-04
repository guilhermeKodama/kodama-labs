import { WallexRecord, SyncResult } from '../types';

// Conditional imports for Capacitor plugins
let Http: any;

if (typeof window !== 'undefined') {
  try {
    const httpModule = require('@capacitor-community/http');
    Http = httpModule.Http;
  } catch (error) {
    console.warn('HTTP plugin not available:', error);
  }
}

const API_BASE_URL = process.env.NODE_ENV === 'production' 
  ? 'https://your-api-domain.com' 
  : 'http://localhost:3001';

class SyncService {
  private isOnline: boolean = false;

  constructor() {
    // Only initialize in browser environment
    if (typeof window !== 'undefined') {
      this.isOnline = navigator.onLine;
      
      // Listen for online/offline events
      window.addEventListener('online', () => {
        this.isOnline = true;
        console.log('App is now online');
      });

      window.addEventListener('offline', () => {
        this.isOnline = false;
        console.log('App is now offline');
      });
    }
  }

  async syncRecord(record: WallexRecord): Promise<boolean> {
    console.log('🔄 Starting sync for record:', record.id);
    console.log('🌐 API_BASE_URL:', API_BASE_URL);
    console.log('📡 Online status:', this.isOnline);
    
    if (!this.isOnline) {
      console.log('❌ App is offline, skipping sync');
      return false;
    }

    try {
      if (!Http) {
        throw new Error('HTTP plugin not available');
      }
      
      console.log('🚀 Making HTTP request to:', `${API_BASE_URL}/api/records`);
      const response = await Http.post({
        url: `${API_BASE_URL}/api/records`,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
        data: {
          userId: record.userId,
          title: record.title,
          description: record.description,
          category: record.category,
          amount: record.amount,
          currency: record.currency,
        },
      });

      console.log('📥 Response status:', response.status);
      console.log('📥 Response data:', response.data);

      if (response.status < 200 || response.status >= 300) {
        console.error('❌ HTTP error response:', response.data);
        throw new Error(`HTTP error! status: ${response.status}, body: ${JSON.stringify(response.data)}`);
      }

      const result = response.data;
      console.log('✅ Record synced successfully:', result);
      return true;
    } catch (error) {
      console.error('❌ Failed to sync record:', error);
      console.error('❌ Error details:', {
        name: error instanceof Error ? error.name : 'Unknown',
        message: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined
      });
      return false;
    }
  }

  async syncAllUnsyncedRecords(records: WallexRecord[]): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      syncedCount: 0,
      failedCount: 0,
      errors: []
    };

    if (!this.isOnline) {
      result.success = false;
      result.errors.push('App is offline');
      return result;
    }

    const unsyncedRecords = records.filter(record => !record.synced);
    
    if (unsyncedRecords.length === 0) {
      console.log('No unsynced records to sync');
      return result;
    }

    console.log(`Starting sync of ${unsyncedRecords.length} records...`);

    // Sync records one by one to maintain order
    for (const record of unsyncedRecords) {
      try {
        const success = await this.syncRecord(record);
        if (success) {
          result.syncedCount++;
        } else {
          result.failedCount++;
          result.errors.push(`Failed to sync record ${record.id}`);
        }
      } catch (error) {
        result.failedCount++;
        result.errors.push(`Error syncing record ${record.id}: ${error}`);
      }
    }

    result.success = result.failedCount === 0;
    console.log(`Sync completed: ${result.syncedCount} synced, ${result.failedCount} failed`);
    
    return result;
  }

  isAppOnline(): boolean {
    return this.isOnline;
  }

  async testConnection(): Promise<{ success: boolean; error?: string; details?: any }> {
    try {
      if (!Http) {
        throw new Error('HTTP plugin not available');
      }
      
      console.log('🔍 Testing connection to:', API_BASE_URL);
      console.log('🌐 Online status:', this.isOnline);
      
      const response = await Http.get({
        url: `${API_BASE_URL}/health`,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json',
        },
      });
      
      console.log('📡 Response status:', response.status);
      console.log('📡 Response data:', response.data);
      
      if (response.status >= 200 && response.status < 300) {
        console.log('✅ Connection test successful:', response.data);
        return { success: true, details: response.data };
      } else {
        console.error('❌ Connection test failed - HTTP error:', response.status, response.data);
        return { 
          success: false, 
          error: `HTTP ${response.status}: ${JSON.stringify(response.data)}`,
          details: { status: response.status, body: response.data }
        };
      }
    } catch (error) {
      console.error('❌ Connection test failed - Network error:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : String(error),
        details: {
          name: error instanceof Error ? error.name : 'Unknown',
          message: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined
        }
      };
    }
  }
}

export const syncService = new SyncService();
