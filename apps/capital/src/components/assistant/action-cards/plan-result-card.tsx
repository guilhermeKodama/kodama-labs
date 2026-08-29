'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Check, RefreshCw, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAssistantStore } from '@/lib/store';
import { ActionCardShell } from './action-card-shell';

interface PlanResultCardProps {
  conversationId: string;
  result: Record<string, unknown>;
}

export function PlanResultCard({ conversationId, result }: PlanResultCardProps) {
  const t = useTranslations('assistant.cards.result');
  const sendMessage = useAssistantStore((s) => s.sendMessage);
  const [undoing, setUndoing] = useState(false);
  const [undone, setUndone] = useState(false);

  const isRevert = 'transactionsDeleted' in result;
  const imported = Number(result.imported ?? 0);
  const duplicatesSkipped = Number(result.duplicatesSkipped ?? 0);
  const reconciled = Number(result.reconciled ?? 0);
  const transfersCreated = Number(result.transfersCreated ?? 0);
  const statementImportId = result.statementImportId as string | undefined;

  const handleUndo = async () => {
    if (!statementImportId) return;
    setUndoing(true);
    await sendMessage(conversationId, {
      text: `Desfaça a importação ${statementImportId}, por favor.`,
    });
    setUndoing(false);
    setUndone(true);
  };

  if (isRevert) {
    return (
      <ActionCardShell icon={<RefreshCw className="h-[18px] w-[18px]" />} title="Reversão concluída" locked>
        <p className="text-sm text-slate-300">
          {Number(result.transactionsDeleted ?? 0)} transações removidas.
        </p>
      </ActionCardShell>
    );
  }

  return (
    <ActionCardShell
      icon={<Check className="h-[18px] w-[18px]" />}
      title={t('title')}
      locked
      footer={
        statementImportId &&
        !undone && (
          <div className="flex items-center justify-between gap-3">
            <span className="text-xs text-slate-500">{t('undoWindow', { hours: 24 })}</span>
            <Button variant="outline" size="sm" disabled={undoing} onClick={handleUndo} className="border-red-500/40 text-red-400 hover:bg-red-500/10">
              <Undo2 className="h-3.5 w-3.5" />
              {t('undo')}
            </Button>
          </div>
        )
      }
    >
      <div className="space-y-2 text-sm">
        <p className="flex items-center gap-2 text-slate-200">
          <Check className="h-3.5 w-3.5 text-emerald-400" />
          {t('imported', { count: imported })}
        </p>
        {reconciled > 0 && (
          <p className="flex items-center gap-2 text-slate-200">
            <RefreshCw className="h-3.5 w-3.5 text-amber-400" />
            {t('merged', { count: reconciled })}
          </p>
        )}
        {duplicatesSkipped > 0 && (
          <p className="flex items-center gap-2 text-slate-400">
            <Check className="h-3.5 w-3.5 text-slate-500" />
            {t('duplicatesSkipped', { count: duplicatesSkipped })}
          </p>
        )}
        {transfersCreated > 0 && (
          <p className="flex items-center gap-2 text-slate-200">
            <Check className="h-3.5 w-3.5 text-purple-400" />
            {t('transfersCreated', { count: transfersCreated })}
          </p>
        )}
        {undone && <p className="text-emerald-400">{t('undone')}</p>}
      </div>
    </ActionCardShell>
  );
}
