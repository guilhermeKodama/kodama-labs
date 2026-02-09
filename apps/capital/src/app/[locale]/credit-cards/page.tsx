'use client';

import { useState, useMemo, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import {
  CreditCard as CreditCardIcon,
  Plus,
  Upload,
  Wallet,
  FileText,
  Repeat,
  BarChart3,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { CreditCardVisual } from '@/components/cards/credit-card-visual';
import { CreditCardDialog } from '@/components/dialogs/credit-card-dialog';
import { BillUploadDialog } from '@/components/dialogs/bill-upload-dialog';
import { BillsTable } from '@/components/tables/bills-table';
import { InstallmentsTable } from '@/components/tables/installments-table';
import { BillTransactionsTable } from '@/components/tables/bill-transactions-table';
import { CategoryPieChart } from '@/components/charts';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  useCreditCardStore,
  useTransactionStore,
  useBusinessStore,
  useSettingsStore,
} from '@/lib/store';
import { formatCurrency } from '@/lib/utils/format';
import { toast } from 'sonner';
import type { CreditCard, CreditCardBill, Installment } from '@/types';

export default function CreditCardsPage() {
  const t = useTranslations();
  const {
    creditCards,
    bills,
    billTransactions,
    installments,
    fetchCreditCards,
    addCreditCard,
    updateCreditCard,
    deleteCreditCard,
    fetchBills,
    fetchInstallments,
    fetchBillTransactions,
    uploadBill,
    deleteBill,
    createBillExpense,
    linkBillToTransaction,
    updateBillTransactionCategory,
  } = useCreditCardStore();
  const { transactions, fetchTransactions } = useTransactionStore();
  const { businesses } = useBusinessStore();
  const { settings, categories } = useSettingsStore();

  const [isCardDialogOpen, setIsCardDialogOpen] = useState(false);
  const [isUploadDialogOpen, setIsUploadDialogOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCard | undefined>();
  const [deletingCard, setDeletingCard] = useState<CreditCard | undefined>();
  const [selectedBillId, setSelectedBillId] = useState<string | null>(null);
  const [selectedView, setSelectedView] = useState<string>('cards');

  // Fetch data on mount
  useEffect(() => {
    fetchCreditCards();
    fetchBills();
    fetchInstallments();
  }, [fetchCreditCards, fetchBills, fetchInstallments]);

  // Auto-refresh when there are pending/processing categorizations
  const hasPendingCategorization = useMemo(
    () => bills.some((b: CreditCardBill) => b.categorizationStatus === 'pending' || b.categorizationStatus === 'processing'),
    [bills]
  );

  useEffect(() => {
    if (!hasPendingCategorization) return;
    const interval = setInterval(() => {
      fetchBills();
    }, 10000); // Poll every 10 seconds
    return () => clearInterval(interval);
  }, [hasPendingCategorization, fetchBills]);

  // Calculate balances for each card (from pending bills)
  const cardBalances = useMemo(() => {
    const balances: Record<string, number> = {};
    for (const bill of bills) {
      if (bill.status === 'pending' || bill.status === 'overdue') {
        balances[bill.creditCardId] = (balances[bill.creditCardId] || 0) + bill.totalAmount;
      }
    }
    return balances;
  }, [bills]);

  // Summary calculations
  const summaries = useMemo(() => {
    const activeCards = creditCards.filter((c: CreditCard) => c.isActive);
    const totalCredit = activeCards.reduce((sum: number, c: CreditCard) => sum + c.creditLimit, 0);
    const totalBalance = Object.values(cardBalances).reduce((sum: number, b: number) => sum + b, 0);
    const pendingBills = bills.filter((b: CreditCardBill) => b.status === 'pending' || b.status === 'overdue');
    const upcomingBillsAmount = pendingBills.reduce((sum: number, b: CreditCardBill) => sum + b.totalAmount, 0);
    const activeInstallments = installments.filter((i: Installment) => i.isActive);

    return {
      totalCredit,
      totalBalance,
      upcomingBillsAmount,
      upcomingBillsCount: pendingBills.length,
      activeInstallmentsCount: activeInstallments.length,
    };
  }, [creditCards, cardBalances, bills, installments]);

  // Category breakdown from bill transactions
  const categoryBreakdown = useMemo(() => {
    const breakdown: Record<string, number> = {};
    for (const tx of billTransactions) {
      breakdown[tx.category] = (breakdown[tx.category] || 0) + tx.amount;
    }
    return Object.entries(breakdown)
      .map(([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
  }, [billTransactions]);

  // Get entity name for a card
  const getEntityName = (card: CreditCard) => {
    if (card.entityType === 'personal') return t('common.personal');
    const biz = businesses.find((b) => b.id === card.entityId);
    return biz?.name || t('common.business');
  };

  // Handlers
  const handleCreateCard = async (data: Parameters<typeof addCreditCard>[0]) => {
    const result = await addCreditCard(data);
    if (result) {
      toast.success(t('creditCards.toast.created'));
    } else {
      toast.error('Failed to create credit card');
    }
  };

  const handleUpdateCard = async (data: Parameters<typeof updateCreditCard>[1]) => {
    if (editingCard) {
      await updateCreditCard(editingCard.id, data);
      setEditingCard(undefined);
      toast.success(t('creditCards.toast.updated'));
    }
  };

  const handleDeleteCard = async () => {
    if (deletingCard) {
      await deleteCreditCard(deletingCard.id);
      setDeletingCard(undefined);
      toast.success(t('creditCards.toast.deleted'));
    }
  };

  const handleDeleteBill = async (billId: string) => {
    await deleteBill(billId);
    toast.success('Bill deleted');
  };

  const handleCreateExpenseFromBill = async (billId: string) => {
    const bill = bills.find((b: CreditCardBill) => b.id === billId);
    if (!bill) return;
    const card = creditCards.find((c: CreditCard) => c.id === bill.creditCardId);
    if (!card) return;
    await createBillExpense({
      billId,
      entityType: card.entityType,
      businessId: card.entityType === 'business' ? card.entityId : undefined,
      personalAccountId: card.entityType === 'personal' ? card.entityId : undefined,
      currency: card.currency,
      date: new Date(bill.dueDate).toISOString().split('T')[0],
    });
    // Refresh transactions so other pages (personal/business) reflect the new expense
    await fetchTransactions();
    toast.success(t('creditCards.toast.expenseCreated'));
  };

  const handleLinkTransaction = async (billId: string, transactionId: string) => {
    await linkBillToTransaction(billId, transactionId);
    toast.success(t('creditCards.toast.billLinked'));
  };

  const handleUploadBill = async (data: Parameters<typeof uploadBill>[0] & { createExpense: boolean }) => {
    const { createExpense: shouldCreateExpense, ...uploadData } = data;
    const result = await uploadBill(uploadData);
    if (result) {
      // Create expense transaction if user chose that option (only for new uploads, not replacements)
      if (shouldCreateExpense && result.bill && !result.replaced) {
        const selectedCard = creditCards.find((c: CreditCard) => c.id === data.creditCardId);
        if (selectedCard) {
          await createBillExpense({
            billId: result.bill.id,
            entityType: selectedCard.entityType,
            // Use the card's own entity ID for correct association
            businessId: selectedCard.entityType === 'business' ? selectedCard.entityId : undefined,
            personalAccountId: selectedCard.entityType === 'personal' ? selectedCard.entityId : undefined,
            currency: selectedCard.currency,
            date: data.dueDate,
          });
          await fetchTransactions();
          toast.success(t('creditCards.toast.expenseCreated'));
        }
      }
      toast.success(result.replaced
        ? t('creditCards.toast.billReplaced')
        : t('creditCards.toast.billUploaded')
      );
      // Refresh data to reflect new installments
      await fetchInstallments();
    }
  };

  const handleViewBillTransactions = (billId: string) => {
    setSelectedBillId(billId);
    fetchBillTransactions(billId);
    setSelectedView('transactions');
  };

  const openEditDialog = (card: CreditCard) => {
    setEditingCard(card);
    setIsCardDialogOpen(true);
  };

  const closeCardDialog = () => {
    setIsCardDialogOpen(false);
    setEditingCard(undefined);
  };

  return (
    <AppShell>
      <Header
        title={t('creditCards.title')}
        description={t('creditCards.subtitle')}
        action={{
          label: t('creditCards.addCard'),
          onClick: () => setIsCardDialogOpen(true),
        }}
      />

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t('creditCards.summary.totalCredit')}
          value={summaries.totalCredit}
          currency={settings.baseCurrency}
          icon={CreditCardIcon}
          variant="default"
        />
        <SummaryCard
          title={t('creditCards.summary.currentBalance')}
          value={summaries.totalBalance}
          currency={settings.baseCurrency}
          icon={Wallet}
          variant="expense"
        />
        <SummaryCard
          title={t('creditCards.summary.upcomingBills')}
          value={summaries.upcomingBillsCount}
          icon={FileText}
          variant={summaries.upcomingBillsCount > 0 ? 'expense' : 'default'}
          isCount
        />
        <SummaryCard
          title={t('creditCards.summary.activeInstallments')}
          value={summaries.activeInstallmentsCount}
          icon={Repeat}
          variant="default"
          isCount
        />
      </div>

      {/* Tabs */}
      <Tabs value={selectedView} onValueChange={setSelectedView}>
        <div className="mb-6 flex items-center justify-between">
          <TabsList className="border-slate-800 bg-slate-900/50">
            <TabsTrigger
              value="cards"
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              <CreditCardIcon className="mr-1.5 h-3.5 w-3.5" />
              {t('creditCards.tabs.cards')}
            </TabsTrigger>
            <TabsTrigger
              value="bills"
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              <FileText className="mr-1.5 h-3.5 w-3.5" />
              {t('creditCards.tabs.bills')}
            </TabsTrigger>
            <TabsTrigger
              value="transactions"
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              {t('creditCards.tabs.transactions')}
            </TabsTrigger>
            <TabsTrigger
              value="installments"
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              <Repeat className="mr-1.5 h-3.5 w-3.5" />
              {t('creditCards.tabs.installments')}
            </TabsTrigger>
            <TabsTrigger
              value="analytics"
              className="data-[state=active]:bg-slate-800 data-[state=active]:text-white"
            >
              <BarChart3 className="mr-1.5 h-3.5 w-3.5" />
              {t('creditCards.tabs.analytics')}
            </TabsTrigger>
          </TabsList>

          <Button
            variant="outline"
            onClick={() => setIsUploadDialogOpen(true)}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white"
          >
            <Upload className="mr-2 h-4 w-4" />
            {t('creditCards.uploadBill')}
          </Button>
        </div>

        {/* Cards Tab */}
        <TabsContent value="cards">
          {creditCards.length === 0 ? (
            <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
              <CardContent className="py-12 text-center">
                <CreditCardIcon className="mx-auto mb-4 h-12 w-12 text-slate-600" />
                <p className="text-slate-400">{t('creditCards.noCards')}</p>
                <Button
                  onClick={() => setIsCardDialogOpen(true)}
                  className="mt-4 bg-emerald-600 text-white hover:bg-emerald-700"
                >
                  <Plus className="mr-2 h-4 w-4" />
                  {t('creditCards.addCard')}
                </Button>
              </CardContent>
            </Card>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {creditCards.map((card: CreditCard) => (
                <CreditCardVisual
                  key={card.id}
                  card={card}
                  currentBalance={cardBalances[card.id] || 0}
                  entityName={getEntityName(card)}
                  onEdit={openEditDialog}
                  onDelete={setDeletingCard}
                />
              ))}
            </div>
          )}
        </TabsContent>

        {/* Bills Tab */}
        <TabsContent value="bills">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('creditCards.tabs.bills')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <BillsTable
                bills={bills}
                currency={settings.baseCurrency}
                expenseTransactions={transactions.filter((tx) => tx.type === 'expense')}
                onViewTransactions={handleViewBillTransactions}
                onCreateExpense={handleCreateExpenseFromBill}
                onLinkTransaction={handleLinkTransaction}
                onDelete={handleDeleteBill}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Transactions Tab */}
        <TabsContent value="transactions">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('creditCards.tabs.transactions')}
                {selectedBillId && (
                  <span className="ml-2 text-sm font-normal text-slate-400">
                    (Bill: {bills.find((b: CreditCardBill) => b.id === selectedBillId)?.creditCard?.bankName} ****
                    {bills.find((b: CreditCardBill) => b.id === selectedBillId)?.creditCard?.lastFourDigits})
                  </span>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent>
              {selectedBillId ? (
                <BillTransactionsTable
                  transactions={billTransactions}
                  currency={settings.baseCurrency}
                  categories={categories}
                  onUpdateCategory={(txId, category) => {
                    updateBillTransactionCategory(txId, category);
                  }}
                />
              ) : (
                <div className="py-8 text-center text-slate-400">
                  Select a bill from the Bills tab to view its transactions.
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Installments Tab */}
        <TabsContent value="installments">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('creditCards.tabs.installments')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <InstallmentsTable
                installments={installments}
                currency={settings.baseCurrency}
              />
            </CardContent>
          </Card>
        </TabsContent>

        {/* Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                Spending by Category
              </CardTitle>
            </CardHeader>
            <CardContent>
              {categoryBreakdown.length > 0 ? (
                <CategoryPieChart
                  data={categoryBreakdown}
                  currency={settings.baseCurrency}
                />
              ) : (
                <div className="py-8 text-center text-slate-400">
                  Upload a bill to see category analytics.
                </div>
              )}
            </CardContent>
          </Card>

          {/* Per-card breakdown */}
          {creditCards.length > 0 && bills.length > 0 && (
            <div className="grid gap-6 lg:grid-cols-2">
              {creditCards
                .filter((card: CreditCard) => card.isActive)
                .map((card: CreditCard) => {
                  const cardBills = bills.filter((b: CreditCardBill) => b.creditCardId === card.id);
                  const cardTotal = cardBills.reduce((sum: number, b: CreditCardBill) => sum + b.totalAmount, 0);

                  return (
                    <Card key={card.id} className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
                      <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-base text-white">
                          <div
                            className="h-3 w-3 rounded-full"
                            style={{ backgroundColor: card.color }}
                          />
                          {card.bankName} ****{card.lastFourDigits}
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-2">
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-400">Total Bills</span>
                            <span className="text-white">{cardBills.length}</span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-400">Total Amount</span>
                            <span className="font-medium text-white">
                              {formatCurrency(cardTotal, card.currency)}
                            </span>
                          </div>
                          <div className="flex justify-between text-sm">
                            <span className="text-slate-400">Credit Utilization</span>
                            <span className="text-white">
                              {card.creditLimit > 0
                                ? `${(((cardBalances[card.id] || 0) / card.creditLimit) * 100).toFixed(0)}%`
                                : '0%'}
                            </span>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Credit Card Dialog */}
      <CreditCardDialog
        open={isCardDialogOpen}
        onOpenChange={closeCardDialog}
        card={editingCard}
        onSubmit={editingCard ? handleUpdateCard : handleCreateCard}
      />

      {/* Bill Upload Dialog */}
      <BillUploadDialog
        open={isUploadDialogOpen}
        onOpenChange={setIsUploadDialogOpen}
        creditCards={creditCards}
        bills={bills}
        expenseTransactions={transactions.filter((t) => t.type === 'expense')}
        onSubmit={handleUploadBill}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingCard}
        onOpenChange={() => setDeletingCard(undefined)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('creditCards.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('creditCards.delete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteCard}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
