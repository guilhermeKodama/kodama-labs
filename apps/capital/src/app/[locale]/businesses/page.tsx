'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Plus, Building2, MoreVertical, Pencil, Trash2 } from 'lucide-react';
import { AppShell } from '@/components/layout';
import { Header } from '@/components/layout/header';
import { BusinessCard } from '@/components/cards';
import { BusinessDialog } from '@/components/dialogs';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  useBusinessStore,
  useTransactionStore,
  useTransferStore,
  useSettingsStore,
} from '@/lib/store';
import { calculateEntitySummary } from '@/lib/utils/calculations';
import { toast } from 'sonner';
import type { Business } from '@/types';
import type { CreateBusinessFormData } from '@/lib/validations';

export default function BusinessesPage() {
  const t = useTranslations();
  const { businesses, addBusiness, updateBusiness, deleteBusiness } =
    useBusinessStore();
  const { transactions, deleteTransactionsByEntity } = useTransactionStore();
  const { transfers, deleteTransfersByEntity } = useTransferStore();
  const { settings } = useSettingsStore();

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<Business | undefined>();
  const [deletingBusiness, setDeletingBusiness] = useState<Business | undefined>();

  const businessSummaries = useMemo(() => {
    return businesses.map((business) =>
      calculateEntitySummary(
        business.id,
        'business',
        business.name,
        transactions,
        transfers,
        settings.baseCurrency
      )
    );
  }, [businesses, transactions, transfers, settings.baseCurrency]);

  const handleCreate = async (data: CreateBusinessFormData) => {
    // userId is now taken from session on the backend
    await addBusiness(data);
    toast.success(t('businesses.toast.created'));
  };

  const handleUpdate = async (data: CreateBusinessFormData) => {
    if (editingBusiness) {
      await updateBusiness(editingBusiness.id, data);
      setEditingBusiness(undefined);
      toast.success(t('businesses.toast.updated'));
    }
  };

  const handleDelete = async () => {
    if (deletingBusiness) {
      // Delete all related transactions and transfers
      await deleteTransactionsByEntity(deletingBusiness.id);
      await deleteTransfersByEntity(deletingBusiness.id);
      await deleteBusiness(deletingBusiness.id);
      setDeletingBusiness(undefined);
      toast.success(t('businesses.toast.deleted'));
    }
  };

  const openEditDialog = (business: Business) => {
    setEditingBusiness(business);
    setIsDialogOpen(true);
  };

  const closeDialog = () => {
    setIsDialogOpen(false);
    setEditingBusiness(undefined);
  };

  return (
    <AppShell>
      <Header
        title={t('businesses.title')}
        description={t('businesses.description')}
        action={{
          label: t('businesses.addBusiness'),
          onClick: () => setIsDialogOpen(true),
        }}
      />

      {businesses.length === 0 ? (
        <Card className="border-slate-800 bg-slate-900/50 backdrop-blur-sm">
          <CardContent className="py-16 text-center">
            <Building2 className="mx-auto mb-4 h-16 w-16 text-slate-600" />
            <h3 className="mb-2 text-lg font-medium text-white">
              {t('businesses.empty.title')}
            </h3>
            <p className="mb-6 text-slate-400">
              {t('businesses.empty.description')}
            </p>
            <Button
              onClick={() => setIsDialogOpen(true)}
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:from-emerald-600 hover:to-cyan-600"
            >
              <Plus className="mr-2 h-4 w-4" />
              {t('businesses.addBusiness')}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {businesses.map((business, index) => (
            <div key={business.id} className="relative">
              <BusinessCard
                business={business}
                summary={businessSummaries[index]}
              />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="absolute right-2 top-2 h-8 w-8 text-slate-400 hover:bg-slate-800 hover:text-white"
                    onClick={(e) => e.preventDefault()}
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="border-slate-700 bg-slate-900"
                >
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      openEditDialog(business);
                    }}
                    className="text-slate-300 focus:bg-slate-800 focus:text-white"
                  >
                    <Pencil className="mr-2 h-4 w-4" />
                    {t('common.edit')}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.preventDefault();
                      setDeletingBusiness(business);
                    }}
                    className="text-red-400 focus:bg-red-500/10 focus:text-red-400"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    {t('common.delete')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Dialog */}
      <BusinessDialog
        open={isDialogOpen}
        onOpenChange={closeDialog}
        business={editingBusiness}
        onSubmit={editingBusiness ? handleUpdate : handleCreate}
      />

      {/* Delete Confirmation */}
      <AlertDialog
        open={!!deletingBusiness}
        onOpenChange={() => setDeletingBusiness(undefined)}
      >
        <AlertDialogContent className="border-slate-800 bg-slate-900">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-white">
              {t('businesses.delete.title')}
            </AlertDialogTitle>
            <AlertDialogDescription className="text-slate-400">
              {t('businesses.delete.description', {
                name: deletingBusiness?.name || '',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
              {t('common.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
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
