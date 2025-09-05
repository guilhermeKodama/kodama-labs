import { Capacitor } from '@capacitor/core';

// Conditional imports for Capacitor plugins
let CapacitorSQLite: any;
let SQLiteConnection: any;
let SQLiteDBConnection: any;

if (typeof window !== 'undefined') {
  try {
    const sqliteModule = require('@capacitor-community/sqlite');
    CapacitorSQLite = sqliteModule.CapacitorSQLite;
    SQLiteConnection = sqliteModule.SQLiteConnection;
    SQLiteDBConnection = sqliteModule.SQLiteDBConnection;
  } catch (error) {
    console.warn('SQLite plugin not available:', error);
  }
}
import { WallexRecord } from '../types';

export type { WallexRecord };

// New transaction interface matching the API
export interface Transaction {
  id?: number;
  type: 'EXPENSE' | 'INCOME' | 'INVESTMENT';
  description: string;
  amount: number;
  status: 'PAID' | 'PENDING' | 'OVERDUE' | 'DRAFT';
  dueAt: string; // ISO date string
  category?: string;
  symbol?: string;
  quantity?: number;
  timestamp: string;
  synced: boolean;
}

class StorageService {
  private db: any = null;
  private sqlite: any = null;
  private isWebPlatform: boolean = false;
  private isInitialized: boolean = false;

  async initialize(): Promise<void> {
    // If already initialized, return early
    if (this.isInitialized) {
      console.log('Storage already initialized, skipping...');
      return;
    }

    try {
      console.log('Starting database initialization...');
      
      this.isWebPlatform = Capacitor.getPlatform() === 'web';
      
      if (this.isWebPlatform) {
        console.log('Web platform detected, using localStorage fallback');
        // For web platform, use localStorage as a fallback
        if (!localStorage.getItem('wallex_records')) {
          localStorage.setItem('wallex_records', JSON.stringify([]));
        }
        console.log('Web storage initialized successfully!');
        this.isInitialized = true;
        return;
      }

      // For native platforms (iOS/Android), use SQLite
      console.log('Native platform detected, initializing SQLite...');
      
      if (!CapacitorSQLite || !SQLiteConnection) {
        throw new Error('SQLite plugin not available');
      }
      
      this.sqlite = new SQLiteConnection(CapacitorSQLite);
      
      // Try to retrieve existing connection first
      try {
        console.log('Trying to retrieve existing connection...');
        this.db = await this.sqlite.retrieveConnection('wallex_db', false);
        console.log('Retrieved existing connection successfully');
      } catch (error) {
        console.log('No existing connection found, creating new one...');
        this.db = await this.sqlite.createConnection('wallex_db', false, 'no-encryption', 1, false);
        console.log('Opening database...');
        await this.db.open();
      }
      
      console.log('Database opened successfully');
      
      // Create table if it doesn't exist
      await this.db.execute(`
        CREATE TABLE IF NOT EXISTS transactions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          type TEXT NOT NULL,
          description TEXT NOT NULL,
          amount REAL NOT NULL,
          status TEXT NOT NULL,
          dueAt TEXT NOT NULL,
          category TEXT,
          symbol TEXT,
          quantity REAL,
          timestamp TEXT NOT NULL,
          synced INTEGER DEFAULT 0
        )
      `);
      
      console.log('Database initialization completed successfully');
      this.isInitialized = true;
      
    } catch (error) {
      console.error('Database initialization failed:', error);
      // Fallback to localStorage if SQLite fails
      console.log('Falling back to localStorage...');
      this.isWebPlatform = true;
      if (!localStorage.getItem('wallex_records')) {
        localStorage.setItem('wallex_records', JSON.stringify([]));
      }
      this.isInitialized = true;
    }
  }

  async saveTransaction(transaction: Omit<Transaction, 'id' | 'timestamp' | 'synced'>): Promise<number> {
    // Ensure database is initialized
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isWebPlatform) {
      // Use localStorage for web platform
      const transactions = this.getWebTransactions();
      const newTransaction: Transaction = {
        id: Date.now(), // Simple ID generation for web
        type: transaction.type,
        description: transaction.description,
        amount: transaction.amount,
        status: transaction.status,
        dueAt: transaction.dueAt,
        category: transaction.category,
        symbol: transaction.symbol,
        quantity: transaction.quantity,
        timestamp: new Date().toISOString(),
        synced: false
      };
      transactions.push(newTransaction);
      localStorage.setItem('transactions', JSON.stringify(transactions));
      return newTransaction.id!;
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const timestamp = new Date().toISOString();
    const query = `
      INSERT INTO transactions (type, description, amount, status, dueAt, category, symbol, quantity, timestamp, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
    `;

    const result = await this.db.run(query, [
      transaction.type,
      transaction.description,
      transaction.amount,
      transaction.status,
      transaction.dueAt,
      transaction.category || null,
      transaction.symbol || null,
      transaction.quantity || null,
      timestamp
    ]);

    return result.changes?.lastId || 0;
  }

  async saveRecord(record: Omit<WallexRecord, 'id' | 'timestamp' | 'synced'>): Promise<number> {
    if (this.isWebPlatform) {
      // Use localStorage for web platform
      const records = this.getWebRecords();
      const newRecord: WallexRecord = {
        id: Date.now(), // Simple ID generation for web
        userId: record.userId,
        title: record.title,
        description: record.description || '',
        category: record.category,
        amount: record.amount,
        currency: record.currency,
        timestamp: new Date().toISOString(),
        synced: false
      };
      records.push(newRecord);
      localStorage.setItem('wallex_records', JSON.stringify(records));
      return newRecord.id!;
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const timestamp = new Date().toISOString();
    const query = `
      INSERT INTO wallex_records (userId, title, description, category, amount, currency, timestamp, synced)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `;

    const result = await this.db.run(query, [
      record.userId,
      record.title,
      record.description || '',
      record.category,
      record.amount,
      record.currency,
      timestamp
    ]);

    return result.changes?.lastId || 0;
  }

  async getUnsyncedRecords(): Promise<WallexRecord[]> {
    if (this.isWebPlatform) {
      const records = this.getWebRecords();
      return records.filter(record => !record.synced);
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM wallex_records WHERE synced = 0 ORDER BY timestamp ASC';
    const result = await this.db.query(query);

    return result.values?.map((row: Record<string, unknown>) => ({
      id: row.id as number,
      userId: row.userId as string,
      title: row.title as string,
      description: row.description as string,
      category: row.category as string,
      amount: row.amount as number,
      currency: row.currency as string,
      timestamp: row.timestamp as string,
      synced: Boolean(row.synced)
    })) || [];
  }

  async markAsSynced(recordId: number): Promise<void> {
    if (this.isWebPlatform) {
      const records = this.getWebRecords();
      const record = records.find(r => r.id === recordId);
      if (record) {
        record.synced = true;
        localStorage.setItem('wallex_records', JSON.stringify(records));
      }
      return;
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const query = 'UPDATE wallex_records SET synced = 1 WHERE id = ?';
    await this.db.run(query, [recordId]);
  }

  async getAllRecords(): Promise<WallexRecord[]> {
    if (this.isWebPlatform) {
      return this.getWebRecords();
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM wallex_records ORDER BY timestamp DESC';
    const result = await this.db.query(query);

    return result.values?.map((row: Record<string, unknown>) => ({
      id: row.id as number,
      userId: row.userId as string,
      title: row.title as string,
      description: row.description as string,
      category: row.category as string,
      amount: row.amount as number,
      currency: row.currency as string,
      timestamp: row.timestamp as string,
      synced: Boolean(row.synced)
    })) || [];
  }

  async getRecordsByCategory(category: string): Promise<WallexRecord[]> {
    if (this.isWebPlatform) {
      const records = this.getWebRecords();
      return records.filter(record => record.category === category);
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM wallex_records WHERE category = ? ORDER BY timestamp DESC';
    const result = await this.db.query(query, [category]);

    return result.values?.map((row: Record<string, unknown>) => ({
      id: row.id as number,
      userId: row.userId as string,
      title: row.title as string,
      description: row.description as string,
      category: row.category as string,
      amount: row.amount as number,
      currency: row.currency as string,
      timestamp: row.timestamp as string,
      synced: Boolean(row.synced)
    })) || [];
  }

  async deleteRecord(recordId: number): Promise<void> {
    if (this.isWebPlatform) {
      const records = this.getWebRecords();
      const filteredRecords = records.filter(record => record.id !== recordId);
      localStorage.setItem('wallex_records', JSON.stringify(filteredRecords));
      return;
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const query = 'DELETE FROM wallex_records WHERE id = ?';
    await this.db.run(query, [recordId]);
  }

  async close(): Promise<void> {
    if (this.db) {
      await this.db.close();
      this.db = null;
    }
  }

  async getAllTransactions(): Promise<Transaction[]> {
    // Ensure database is initialized
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isWebPlatform) {
      return this.getWebTransactions();
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM transactions ORDER BY timestamp DESC';
    const result = await this.db.query(query);

    return result.values?.map((row: Record<string, unknown>) => ({
      id: row.id as number,
      type: row.type as 'EXPENSE' | 'INCOME' | 'INVESTMENT',
      description: row.description as string,
      amount: row.amount as number,
      status: row.status as 'PAID' | 'PENDING' | 'OVERDUE' | 'DRAFT',
      dueAt: row.dueAt as string,
      category: row.category as string | undefined,
      symbol: row.symbol as string | undefined,
      quantity: row.quantity as number | undefined,
      timestamp: row.timestamp as string,
      synced: Boolean(row.synced)
    })) || [];
  }

  async getUnsyncedTransactions(): Promise<Transaction[]> {
    // Ensure database is initialized
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isWebPlatform) {
      const transactions = this.getWebTransactions();
      return transactions.filter(transaction => !transaction.synced);
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const query = 'SELECT * FROM transactions WHERE synced = 0 ORDER BY timestamp ASC';
    const result = await this.db.query(query);

    return result.values?.map((row: Record<string, unknown>) => ({
      id: row.id as number,
      type: row.type as 'EXPENSE' | 'INCOME' | 'INVESTMENT',
      description: row.description as string,
      amount: row.amount as number,
      status: row.status as 'PAID' | 'PENDING' | 'OVERDUE' | 'DRAFT',
      dueAt: row.dueAt as string,
      category: row.category as string | undefined,
      symbol: row.symbol as string | undefined,
      quantity: row.quantity as number | undefined,
      timestamp: row.timestamp as string,
      synced: Boolean(row.synced)
    })) || [];
  }

  async markTransactionAsSynced(transactionId: number): Promise<void> {
    // Ensure database is initialized
    if (!this.isInitialized) {
      await this.initialize();
    }

    if (this.isWebPlatform) {
      const transactions = this.getWebTransactions();
      const transaction = transactions.find(t => t.id === transactionId);
      if (transaction) {
        transaction.synced = true;
        localStorage.setItem('transactions', JSON.stringify(transactions));
      }
      return;
    }

    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const query = 'UPDATE transactions SET synced = 1 WHERE id = ?';
    await this.db.run(query, [transactionId]);
  }

  private getWebRecords(): WallexRecord[] {
    try {
      const records = localStorage.getItem('wallex_records');
      return records ? JSON.parse(records) : [];
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return [];
    }
  }

  private getWebTransactions(): Transaction[] {
    try {
      const transactions = localStorage.getItem('transactions');
      return transactions ? JSON.parse(transactions) : [];
    } catch (error) {
      console.error('Error reading transactions from localStorage:', error);
      return [];
    }
  }
}

export const storageService = new StorageService();
