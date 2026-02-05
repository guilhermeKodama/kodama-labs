'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQueryState, parseAsStringLiteral } from 'nuqs';
import { useTranslations } from 'next-intl';
import {
  ArrowLeftRight,
  Plus,
  TrendingUp,
  TrendingDown,
  Building2,
  Repeat,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { TransfersTable, RecurringTransfersTable } from '@/components/tables';
import { TransferDialog, RecurringTransferDialog } from '@/components/dialogs';
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
  useTransferStore,
  useBusinessStore,
  useSettingsStore,
  useRecurringTransferStore,
} from '@/lib/store';
import { toast } from 'sonner';
import type { Transfer, RecurringTransfer, CreateRecurringTransferInput } from '@/types';
import type { CreateTransferFormData } from '@/lib/validations';
import type { RecurringTransferFormData } from '@/components/forms/recurring-transfer-form';
import { Link } from '@/i18n/navigation';

const tabOptions = ['history', 'recurring'] as const;

export default function TransfersPage() {
  const t = useTranslations();
  const { transfers, addTransfer, deleteTransfer, fetchTransfers } = useTransferStore();
  const { businesses } = useBusinessStore();
  const { settings, personalAccount } = useSettingsStore();
  const {
    recurringTransfers,
    addRecurringTransfer,
    updateRecurringTransfer,
    deleteRecurringTransfer,
    toggleRecurringTransfer,
    markAsPaid,
  } = useRecurringTransferStore();

  // Use nuqs for URL-synced tab state
  const [activeTab, setActiveTab] = useQueryState(
    'tab',
    parseAsStringLiteral(tabOptions).withDefault('history')
  );

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [isRecurringDialogOpen, setIsRecurringDialogOpen] = useState(false);
  const [deletingTransfer, setDeletingTransfer] = useState<Transfer | undefined>();
  const [editingRecurring, setEditingRecurring] = useState<RecurringTransfer | undefined>();
  const [deletingRecurring, setDeletingRecurring] = useState<RecurringTransfer | undefined>();
  const [markingPaidId, setMarkingPaidId] = useState<string | null>(null);

  // Calculate transfer summaries
  const summaries = useMemo(() => {
    const profitDistributions = transfers
      .filter((t) => t.direction === 'profit_distribution')
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    const capitalInjections = transfers
      .filter((t) => t.direction === 'capital_injection')
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    const reimbursements = transfers
      .filter((t) => t.direction === 'reimbursement')
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    return {
      profitDistributions,
      capitalInjections,
      reimbursements,
      totalTransfers: transfers.length,
    };
  }, [transfers]);

  // Calculate recurring summary
  const recurringSummary = useMemo(() => {
    const active = recurringTransfers.filter((rt) => rt.isActive);
    const monthlyTotal = active
      .filter((rt) => rt.frequency === 'monthly')
      .reduce((sum, rt) => sum + rt.amount * rt.exchangeRate, 0);

    return {
      total: recurringTransfers.length,
      active: active.length,
      monthlyTotal,
    };
  }, [recurringTransfers]);

  const handleCreateTransfer = async (data: CreateTransferFormData) => {
    await addTransfer(data);
    toast.success(t('transfers.toast.created'));
  };

  const handleDeleteTransfer = async () => {
    if (deletingTransfer) {
      await deleteTransfer(deletingTransfer.id);
      setDeletingTransfer(undefined);
      toast.success(t('transfers.toast.deleted'));
    }
  };

  const handleCreateRecurringTransfer = async (data: RecurringTransferFormData) => {
    const input: CreateRecurringTransferInput = {
      fromEntityId: data.fromEntityId,
      fromEntityType: data.fromEntityType,
      toEntityId: data.toEntityId,
      toEntityType: data.toEntityType,
      direction: data.direction,
      amount: data.amount,
      currency: data.currency,
      exchangeRate: data.exchangeRate,
      description: data.description,
      frequency: data.frequency,
      startDate: data.startDate,
      endDate: data.endDate ?? undefined,
    };
    await addRecurringTransfer(input);
    toast.success(t('transfers.recurring.toast.created'));
  };

  const handleUpdateRecurringTransfer = async (data: RecurringTransferFormData) => {
    if (editingRecurring) {
      await updateRecurringTransfer(editingRecurring.id, {
        direction: data.direction,
        amount: data.amount,
        currency: data.currency,
        exchangeRate: data.exchangeRate,
        description: data.description,
        frequency: data.frequency,
        startDate: data.startDate,
        endDate: data.endDate ?? undefined,
      });
      setEditingRecurring(undefined);
      toast.success(t('transfers.recurring.toast.updated'));
    }
  };

  const handleDeleteRecurringTransfer = async () => {
    if (deletingRecurring) {
      await deleteRecurringTransfer(deletingRecurring.id);
      setDeletingRecurring(undefined);
      toast.success(t('transfers.recurring.toast.deleted'));
    }
  };

  const handleToggleRecurring = async (recurring: RecurringTransfer) => {
    await toggleRecurringTransfer(recurring.id);
    toast.success(
      recurring.isActive
        ? t('transfers.recurring.toast.paused')
        : t('transfers.recurring.toast.resumed')
    );
  };

  const handleMarkPaid = useCallback(async (recurring: RecurringTransfer) => {
    setMarkingPaidId(recurring.id);
    try {
      const result = await markAsPaid(recurring.id);
      if (result) {
        await fetchTransfers();
        toast.success(t('transfers.recurring.toast.markedPaid'));
      } else {
        toast.error(t('transfers.recurring.toast.markPaidError'));
      }
    } catch {
      toast.error(t('transfers.recurring.toast.markPaidError'));
    } finally {
      setMarkingPaidId(null);
    }
  }, [markAsPaid, fetchTransfers, t]);

  const openEditRecurringDialog = (recurring: RecurringTransfer) => {
    setEditingRecurring(recurring);
    setIsRecurringDialogOpen(true);
  };

  const closeRecurringDialog = () => {
    setIsRecurringDialogOpen(false);
    setEditingRecurring(undefined);
  };

  // Show message if no businesses exist
  if (businesses.length === 0) {
    return (
      <AppShell>
        <Header
          title={t('transfers.title')}
          description={t('transfers.subtitle')}
        />

        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <CardContent className="py-16 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500/20 to-orange-500/20">
              <Building2 className="h-8 w-8 text-amber-400" />
            </div>
            <h3 className="mb-2 text-lg font-medium text-white">
              {t('transfers.noBusinesses.title')}
            </h3>
            <p className="mb-6 text-slate-400">
              {t('transfers.noBusinesses.description')}
            </p>
            <Button
              asChild
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
            >
              <Link href="/businesses">
                <Plus className="mr-2 h-4 w-4" />
                {t('transfers.noBusinesses.createBusiness')}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <Header
        title={t('transfers.title')}
        description={t('transfers.subtitle')}
        action={{
          label: activeTab === 'recurring' 
            ? t('transfers.recurring.addRecurring') 
            : t('transfers.addTransfer'),
          onClick: () => activeTab === 'recurring' 
            ? setIsRecurringDialogOpen(true) 
            : setIsDialogOpen(true),
        }}
      />

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard
          title={t('transfers.summary.totalTransfers')}
          value={summaries.totalTransfers}
          icon={ArrowLeftRight}
          variant="default"
          isCount
        />
        <SummaryCard
          title={t('transfers.summary.profitDistributions')}
          value={summaries.profitDistributions}
          currency={settings.baseCurrency}
          icon={TrendingUp}
          variant="income"
        />
        <SummaryCard
          title={t('transfers.summary.capitalInjections')}
          value={summaries.capitalInjections}
          currency={settings.baseCurrency}
          icon={TrendingDown}
          variant="investment"
        />
        <SummaryCard
          title={t('transfers.recurring.summary.active')}
          value={recurringSummary.active}
          icon={Repeat}
          variant="default"
          isCount
        />
      </div>

      {/* Tabbed Content */}
      <Tabs 
        value={activeTab} 
        onValueChange={(value) => setActiveTab(value as typeof tabOptions[number])} 
        className="space-y-4"
      >
        <TabsList className="grid w-full max-w-md grid-cols-2 bg-slate-800">
          <TabsTrigger
            value="history"
            className="data-[state=active]:bg-slate-700"
          >
            {t('transfers.history')}
          </TabsTrigger>
          <TabsTrigger
            value="recurring"
            className="data-[state=active]:bg-slate-700"
          >
            {t('transfers.recurring.title')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="history">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('transfers.history')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <TransfersTable
                transfers={transfers}
                onDelete={setDeletingTransfer}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="recurring">
          <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
            <CardHeader>
              <CardTitle className="text-lg text-white">
                {t('transfers.recurring.list')}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <RecurringTransfersTable
                recurringTransfers={recurringTransfers}
                onEdit={openEditRecurringDialog}
                onDelete={setDeletingRecurring}
                onToggle={handleToggleRecurring}
                onMarkPaid={handleMarkPaid}
                isMarkingPaid={markingPaidId}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Transfer Dialog */}
      <TransferDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSubmit={handleCreateTransfer}
      />

      {/* Recurring Transfer Dialog */}
      <RecurringTransferDialog
        open={isRecurringDialogOpen}
        onOpenChange={closeRecurringDialog}
        recurringTransfer={editingRecurring}
        onSubmit={editingRecurring ? handleUpdateRecurringTransfer : handleCreateRecurringTransfer}
      />

      {/* Delete Transfer Confirmation */}
      <AlertDialog
        open={!!deletingTransfer}
        onOpenChange={() => setDeletingTransfer(undefined)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('transfers.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('transfers.delete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteTransfer}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Recurring Transfer Confirmation */}
      <AlertDialog
        open={!!deletingRecurring}
        onOpenChange={() => setDeletingRecurring(undefined)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('transfers.recurring.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('transfers.recurring.delete.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteRecurringTransfer}
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
