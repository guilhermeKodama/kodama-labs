'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import TransactionsList from './transactions-list';
import TransactionDialog from './transaction-dialog';
import { storageService } from '../services/storage';
import { 
  Receipt, 
  Plus, 
  TrendingUp,
  Filter,
  Search
} from 'lucide-react';

type TabType = 'transactions' | 'insights';

export function BottomNavigation() {
  const [activeTab, setActiveTab] = useState<TabType>('transactions');
  const [showFabModal, setShowFabModal] = useState(false);

  return (
    <div className="h-full flex flex-col">
      {/* Main Content Area */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'transactions' && <TransactionsTab />}
        {activeTab === 'insights' && <InsightsTab />}
      </div>


      {/* Bottom Navigation */}
      <nav className="flex items-center justify-around p-4 border-t border-border bg-card safe-bottom flex-shrink-0">
        {/* Transactions Tab */}
        <Button
          variant="ghost"
          className={`flex flex-col items-center space-y-1 p-2 h-auto ${
            activeTab === 'transactions' ? 'text-primary' : 'text-muted-foreground'
          }`}
          onClick={() => setActiveTab('transactions')}
        >
          <Receipt className="h-5 w-5" />
          <span className="text-xs">Transactions</span>
        </Button>

        {/* Center FAB */}
        <TransactionDialog 
          onSave={async (transaction) => {
            try {
              console.log('Saving transaction:', transaction);
              await storageService.saveTransaction(transaction);
              console.log('Transaction saved successfully');
            } catch (error) {
              console.error('Failed to save transaction:', error);
              throw error; // Re-throw to let the dialog handle the error
            }
          }}
          isLoading={false}
          open={showFabModal}
          onOpenChange={setShowFabModal}
          triggerButton={
            <Button
              size="icon"
              className="h-14 w-14 rounded-full shadow-lg"
            >
              <Plus className="h-6 w-6" />
            </Button>
          }
        />

        {/* Insights Tab */}
        <Button
          variant="ghost"
          className={`flex flex-col items-center space-y-1 p-2 h-auto ${
            activeTab === 'insights' ? 'text-primary' : 'text-muted-foreground'
          }`}
          onClick={() => setActiveTab('insights')}
        >
          <TrendingUp className="h-5 w-5" />
          <span className="text-xs">Insights</span>
        </Button>
      </nav>
    </div>
  );
}

function TransactionsTab() {
  return (
    <div className="h-full flex flex-col">
      <TransactionsList />
    </div>
  );
}

function InsightsTab() {
  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="p-4 border-b border-border">
        <h1 className="text-xl font-semibold">Insights</h1>
        <p className="text-sm text-muted-foreground">Current month overview</p>
      </div>

      {/* Insights Cards */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <Card className="p-4 hover:shadow-md transition-shadow">
            <div className="text-center">
              <p className="text-2xl font-bold text-green-600 dark:text-green-400">+$2,500</p>
              <p className="text-sm text-muted-foreground">Total Income</p>
            </div>
          </Card>
          <Card className="p-4 hover:shadow-md transition-shadow">
            <div className="text-center">
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">-$1,200</p>
              <p className="text-sm text-muted-foreground">Total Expenses</p>
            </div>
          </Card>
        </div>

        <Card className="p-4 hover:shadow-md transition-shadow">
          <div className="text-center">
            <p className="text-3xl font-bold text-primary">+$1,300</p>
            <p className="text-sm text-muted-foreground">Net Income</p>
          </div>
        </Card>

        <Card className="p-4">
          <div className="space-y-3">
            <h3 className="font-semibold">Top Categories</h3>
            <div className="space-y-2">
              {[
                { name: 'Food & Dining', amount: '$450', percentage: '37%' },
                { name: 'Transportation', amount: '$200', percentage: '17%' },
                { name: 'Entertainment', amount: '$150', percentage: '12%' },
              ].map((category, index) => (
                <div key={index} className="flex items-center justify-between">
                  <span className="text-sm">{category.name}</span>
                  <div className="flex items-center space-x-2">
                    <span className="text-sm font-medium">{category.amount}</span>
                    <span className="text-xs text-muted-foreground">{category.percentage}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
