'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import {
  ArrowLeftRight,
  Plus,
  TrendingUp,
  TrendingDown,
  Building2,
} from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { SummaryCard } from '@/components/cards';
import { TransfersTable } from '@/components/tables';
import { TransferDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
} from '@/lib/store';
import { toast } from 'sonner';
import type { Transfer } from '@/types';
import type { CreateTransferFormData } from '@/lib/validations';
import { Link } from '@/i18n/navigation';

export default function TransfersPage() {
  const t = useTranslations();
  const { transfers, addTransfer, deleteTransfer } = useTransferStore();
  const { businesses } = useBusinessStore();
  const { settings, personalAccount } = useSettingsStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [deletingTransfer, setDeletingTransfer] = useState<Transfer | undefined>();

  // Calculate transfer summaries
  const summaries = useMemo(() => {
    const profitDistributions = transfers
      .filter((t) => t.direction === 'profit_distribution')
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    const capitalInjections = transfers
      .filter((t) => t.direction === 'capital_injection')
      .reduce((sum, t) => sum + t.amount * t.exchangeRate, 0);

    return {
      profitDistributions,
      capitalInjections,
      totalTransfers: transfers.length,
    };
  }, [transfers]);

  const handleCreateTransfer = (data: CreateTransferFormData) => {
    addTransfer(data);
    toast.success(t('transfers.toast.created'));
  };

  const handleDeleteTransfer = () => {
    if (deletingTransfer) {
      deleteTransfer(deletingTransfer.id);
      setDeletingTransfer(undefined);
      toast.success(t('transfers.toast.deleted'));
    }
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
          label: t('transfers.addTransfer'),
          onClick: () => setIsDialogOpen(true),
        }}
      />

      {/* Summary Cards */}
      <div className="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
      </div>

      {/* Transfers Table */}
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

      {/* Transfer Dialog */}
      <TransferDialog
        open={isDialogOpen}
        onOpenChange={setIsDialogOpen}
        onSubmit={handleCreateTransfer}
      />

      {/* Delete Confirmation */}
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
    </AppShell>
  );
}
