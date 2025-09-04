'use client';

import { useState, useEffect } from 'react';
import { storageService } from '../services/storage';
import { syncService } from '../services/sync';
import { WallexRecord } from '../types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Separator } from './ui/separator';
import { Plus, RefreshCw, Wifi, WifiOff, DollarSign, Calendar, Tag } from 'lucide-react';

export default function TransactionsList() {
  const [transactions, setTransactions] = useState<WallexRecord[]>([]);
  const [isOnline, setIsOnline] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    initializeApp();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const initializeApp = async () => {
    try {
      setIsLoading(true);
      await storageService.initialize();
      await loadTransactions();
      setIsOnline(syncService.isAppOnline());
      setIsInitialized(true);
    } catch (error) {
      console.error('Failed to initialize app:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadTransactions = async () => {
    try {
      const allTransactions = await storageService.getAllRecords();
      console.log('Loaded transactions:', allTransactions);
      setTransactions(allTransactions);
    } catch (error) {
      console.error('Failed to load transactions:', error);
    }
  };

  const addSampleTransaction = async () => {
    try {
      setIsLoading(true);
      const categories = ['food', 'transport', 'entertainment', 'shopping', 'bills', 'income'];
      const sampleTitles = [
        'Coffee Shop', 'Uber Ride', 'Netflix Subscription', 'Grocery Store',
        'Salary', 'Freelance Work', 'Restaurant', 'Gas Station'
      ];
      
      const newTransaction = {
        userId: 'user123',
        title: sampleTitles[Math.floor(Math.random() * sampleTitles.length)],
        description: 'Sample transaction for testing',
        category: categories[Math.floor(Math.random() * categories.length)],
        amount: Math.floor(Math.random() * 500) + 10,
        currency: 'USD'
      };

      await storageService.saveRecord(newTransaction);
      await loadTransactions();
    } catch (error) {
      console.error('Failed to add transaction:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const syncTransactions = async () => {
    try {
      setIsLoading(true);
      const unsyncedTransactions = await storageService.getUnsyncedRecords();
      const result = await syncService.syncAllUnsyncedRecords(unsyncedTransactions);
      
      if (result.success) {
        for (const transaction of unsyncedTransactions) {
          if (transaction.id) {
            await storageService.markAsSynced(transaction.id);
          }
        }
        await loadTransactions();
      }
    } catch (error) {
      console.error('Failed to sync transactions:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency,
    }).format(amount);
  };

  const formatDate = (timestamp: string) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffInHours = (now.getTime() - date.getTime()) / (1000 * 60 * 60);
    
    if (diffInHours < 24) {
      return date.toLocaleTimeString('en-US', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } else if (diffInHours < 168) { // 7 days
      return date.toLocaleDateString('en-US', { 
        weekday: 'short',
        hour: '2-digit', 
        minute: '2-digit' 
      });
    } else {
      return date.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric' 
      });
    }
  };

  const getCategoryColor = (category: string) => {
    const colors: Record<string, string> = {
      food: 'bg-orange-100 text-orange-800 border-orange-200',
      transport: 'bg-blue-100 text-blue-800 border-blue-200',
      entertainment: 'bg-purple-100 text-purple-800 border-purple-200',
      shopping: 'bg-pink-100 text-pink-800 border-pink-200',
      bills: 'bg-red-100 text-red-800 border-red-200',
      income: 'bg-green-100 text-green-800 border-green-200',
    };
    return colors[category] || 'bg-gray-100 text-gray-800 border-gray-200';
  };

  const getCategoryIcon = (category: string) => {
    // For now, we'll use a simple emoji approach
    const icons: Record<string, string> = {
      food: '🍽️',
      transport: '🚗',
      entertainment: '🎬',
      shopping: '🛍️',
      bills: '📄',
      income: '💰',
    };
    return icons[category] || '📝';
  };

  const unsyncedCount = transactions.filter(t => !t.synced).length;
  const totalAmount = transactions.reduce((sum, t) => sum + t.amount, 0);

  if (!mounted || !isInitialized) {
    return (
      <div className="p-4">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-center">
              <RefreshCw className="h-6 w-6 animate-spin mr-2" />
              <span>Initializing storage...</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      {/* Header Card */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-xl">Transactions</CardTitle>
              <CardDescription>
                {transactions.length} transactions • {formatAmount(totalAmount, 'USD')}
              </CardDescription>
            </div>
            <div className="flex items-center space-x-2">
              {isOnline ? (
                <Badge variant="success" className="flex items-center">
                  <Wifi className="h-3 w-3 mr-1" />
                  Online
                </Badge>
              ) : (
                <Badge variant="warning" className="flex items-center">
                  <WifiOff className="h-3 w-3 mr-1" />
                  Offline
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          <div className="flex space-x-2">
            <Button 
              onClick={addSampleTransaction} 
              disabled={isLoading}
              size="sm"
              className="flex-1"
            >
              <Plus className="h-4 w-4 mr-2" />
              Add Sample
            </Button>
            <Button 
              onClick={syncTransactions} 
              disabled={isLoading || !isOnline || unsyncedCount === 0}
              variant="outline"
              size="sm"
              className="flex-1"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
              Sync ({unsyncedCount})
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Transactions List */}
      {transactions.length === 0 ? (
        <Card>
          <CardContent className="p-6">
            <div className="text-center space-y-2">
              <DollarSign className="h-12 w-12 mx-auto text-muted-foreground" />
              <h3 className="text-lg font-semibold">No transactions yet</h3>
              <p className="text-muted-foreground">
                Add your first transaction to get started
              </p>
              <Button onClick={addSampleTransaction} disabled={isLoading} className="mt-4">
                <Plus className="h-4 w-4 mr-2" />
                Add Sample Transaction
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {transactions.map((transaction, index) => (
            <Card key={transaction.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3 flex-1">
                    <div className="text-2xl">
                      {getCategoryIcon(transaction.category)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center space-x-2">
                        <h4 className="font-semibold text-sm truncate">
                          {transaction.title}
                        </h4>
                        {!transaction.synced && (
                          <Badge variant="warning" className="text-xs">
                            Pending
                          </Badge>
                        )}
                      </div>
                      {transaction.description && (
                        <p className="text-xs text-muted-foreground truncate">
                          {transaction.description}
                        </p>
                      )}
                      <div className="flex items-center space-x-2 mt-1">
                        <Badge 
                          variant="outline" 
                          className={`text-xs ${getCategoryColor(transaction.category)}`}
                        >
                          <Tag className="h-3 w-3 mr-1" />
                          {transaction.category}
                        </Badge>
                        <div className="flex items-center text-xs text-muted-foreground">
                          <Calendar className="h-3 w-3 mr-1" />
                          {formatDate(transaction.timestamp)}
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`font-semibold ${
                      transaction.category === 'income' 
                        ? 'text-green-600' 
                        : 'text-red-600'
                    }`}>
                      {transaction.category === 'income' ? '+' : '-'}
                      {formatAmount(transaction.amount, transaction.currency)}
                    </div>
                  </div>
                </div>
              </CardContent>
              {index < transactions.length - 1 && <Separator />}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
