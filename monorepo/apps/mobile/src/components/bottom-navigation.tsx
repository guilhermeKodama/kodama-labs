'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
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

      {/* FAB Modal */}
      {showFabModal && (
        <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50">
          <div className="bg-background rounded-t-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Add Transaction</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowFabModal(false)}
              >
                ×
              </Button>
            </div>
                    <div className="grid grid-cols-3 gap-4">
          <Button
            variant="outline"
            className="h-20 flex flex-col items-center space-y-2 border-green-200 dark:border-green-800 hover:bg-green-50 dark:hover:bg-green-950"
            onClick={() => {
              // TODO: Handle income
              setShowFabModal(false);
            }}
          >
            <TrendingUp className="h-6 w-6 text-green-600 dark:text-green-400" />
            <span className="text-sm text-green-700 dark:text-green-300">Income</span>
          </Button>
          <Button
            variant="outline"
            className="h-20 flex flex-col items-center space-y-2 border-red-200 dark:border-red-800 hover:bg-red-50 dark:hover:bg-red-950"
            onClick={() => {
              // TODO: Handle expense
              setShowFabModal(false);
            }}
          >
            <Receipt className="h-6 w-6 text-red-600 dark:text-red-400" />
            <span className="text-sm text-red-700 dark:text-red-300">Expense</span>
          </Button>
          <Button
            variant="outline"
            className="h-20 flex flex-col items-center space-y-2 border-blue-200 dark:border-blue-800 hover:bg-blue-50 dark:hover:bg-blue-950"
            onClick={() => {
              // TODO: Handle investment
              setShowFabModal(false);
            }}
          >
            <TrendingUp className="h-6 w-6 text-blue-600 dark:text-blue-400" />
            <span className="text-sm text-blue-700 dark:text-blue-300">Investment</span>
          </Button>
        </div>
          </div>
        </div>
      )}

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
        <Button
          size="icon"
          className="h-14 w-14 rounded-full shadow-lg"
          onClick={() => setShowFabModal(true)}
        >
          <Plus className="h-6 w-6" />
        </Button>

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
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border">
        <h1 className="text-xl font-semibold">Transactions</h1>
        <div className="flex items-center space-x-2">
          <Button variant="ghost" size="icon">
            <Search className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon">
            <Filter className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Transaction List */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {/* Sample transactions */}
        {[
          { type: 'income', amount: '+$2,500.00', description: 'Salary', date: 'Today' },
          { type: 'expense', amount: '-$45.20', description: 'Grocery Store', date: 'Today' },
          { type: 'expense', amount: '-$12.99', description: 'Coffee Shop', date: 'Yesterday' },
          { type: 'investment', amount: '+$150.00', description: 'Stock Dividend', date: '2 days ago' },
        ].map((transaction, index) => (
          <Card key={index} className="p-4 hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className={`w-3 h-3 rounded-full ${
                  transaction.type === 'income' ? 'bg-green-500' :
                  transaction.type === 'expense' ? 'bg-red-500' :
                  'bg-blue-500'
                }`} />
                <div>
                  <p className="font-medium text-foreground">{transaction.description}</p>
                  <p className="text-sm text-muted-foreground">{transaction.date}</p>
                </div>
              </div>
              <p className={`font-semibold ${
                transaction.type === 'income' ? 'text-green-600 dark:text-green-400' :
                transaction.type === 'expense' ? 'text-red-600 dark:text-red-400' :
                'text-blue-600 dark:text-blue-400'
              }`}>
                {transaction.amount}
              </p>
            </div>
          </Card>
        ))}
      </div>
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
