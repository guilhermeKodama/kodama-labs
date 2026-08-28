'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FileText, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAssistantStore } from '@/lib/store';
import type { ImportPlan } from '@/types/assistant';
import { ActionCardShell } from './action-card-shell';

interface ImportPlanCardProps {
  conversationId: string;
  planId: string;
  planKind: ImportPlan['kind'];
  summary: ImportPlan['summary'];
  payloadHash: string;
  warnings: string[];
  status: ImportPlan['status'];
}

function formatMoney(value: number | undefined, currency: string | undefined) {
  if (value === undefined) return '—';
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: currency ?? 'BRL' }).format(value);
  } catch {
    return `${currency ?? ''} ${value.toFixed(2)}`;
  }
}

export function ImportPlanCard({
  conversationId,
  planId,
  summary,
  payloadHash,
  warnings,
  status,
}: ImportPlanCardProps) {
  const t = useTranslations('assistant.cards.importPlan');
  const tCommon = useTranslations('assistant.cards.common');
  const confirmPlan = useAssistantStore((s) => s.confirmPlan);
  const rejectPlan = useAssistantStore((s) => s.rejectPlan);
  const sendMessage = useAssistantStore((s) => s.sendMessage);
  const [busy, setBusy] = useState<'confirm' | 'discard' | null>(null);
  const [localStatus, setLocalStatus] = useState(status);

  const locked = localStatus !== 'proposed';

  const handleConfirm = async () => {
    setBusy('confirm');
    const ok = await confirmPlan(conversationId, planId, payloadHash);
    if (ok) {
      setLocalStatus('confirmed');
      await sendMessage(conversationId, { text: 'Plano confirmado, pode aplicar.' });
    }
    setBusy(null);
  };

  const handleDiscard = async () => {
    setBusy('discard');
    const ok = await rejectPlan(conversationId, planId);
    if (ok) setLocalStatus('rejected');
    setBusy(null);
  };

  const balances = summary.ledgerBalance !== undefined;
  // A bill-only plan has nothing in the transaction/transfer/investment
  // counters - showing that grid (all zeros) reads as "empty plan", not
  // "this bill is what's being proposed". Lead with the bill instead.
  const isBillOnly =
    !!summary.billCount &&
    !summary.newTransactionCount &&
    !summary.transferCount &&
    !summary.investmentTransactionCount;

  return (
    <ActionCardShell
      icon={<FileText className="h-[18px] w-[18px]" />}
      title={t('title')}
      locked={locked}
      footer={
        locked ? (
          <span className="text-xs text-slate-500">
            {localStatus === 'confirmed' && tCommon('decided', { decision: 'confirmado', time: '' })}
            {localStatus === 'rejected' && tCommon('decided', { decision: t('discard').toLowerCase(), time: '' })}
            {localStatus === 'committed' && tCommon('decided', { decision: 'aplicado', time: '' })}
          </span>
        ) : (
          <div className="flex items-center justify-end gap-2">
            <Button variant="outline" size="sm" disabled={busy !== null} onClick={handleDiscard}>
              {t('discard')}
            </Button>
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={handleConfirm}
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:opacity-90"
            >
              {t('confirm')}
              <ArrowRight className="h-3.5 w-3.5" />
            </Button>
          </div>
        )
      }
    >
      {isBillOnly ? (
        <div className="flex items-center gap-4 rounded-lg border border-cyan-500/25 bg-cyan-500/[0.08] p-3.5">
          <div>
            <p className="text-2xl font-bold leading-none text-cyan-400">
              {formatMoney(summary.billTotalPreviewAmount, summary.currency)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {t('bills', { count: summary.billCount ?? 0 })}
              {!!summary.billTransactionPreviewCount &&
                ` · ${t('billItems', { count: summary.billTransactionPreviewCount })}`}
            </p>
          </div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-lg border border-emerald-500/25 bg-emerald-500/[0.08] p-3.5">
              <p className="text-2xl font-bold leading-none text-emerald-400">
                {summary.newTransactionCount ?? 0}
              </p>
              <p className="mt-1 text-xs text-slate-400">{t('new')}</p>
            </div>
            <div className="rounded-lg border border-slate-700 bg-slate-800/50 p-3.5">
              <p className="text-2xl font-bold leading-none text-slate-300">
                {summary.skipDuplicateCount ?? 0}
              </p>
              <p className="mt-1 text-xs text-slate-400">{t('duplicates')}</p>
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3.5">
              <p className="text-2xl font-bold leading-none text-amber-400">{summary.linkFuzzyCount ?? 0}</p>
              <p className="mt-1 text-xs text-amber-400/80">{t('review')}</p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-between border-t border-slate-800 pt-3.5 text-sm">
            <div className="flex gap-5">
              <div>
                <p className="text-[11px] text-slate-500">{t('income')}</p>
                <p className="mono text-emerald-400">{formatMoney(summary.totalIncome, summary.currency)}</p>
              </div>
              <div>
                <p className="text-[11px] text-slate-500">{t('expenses')}</p>
                <p className="mono text-red-400">{formatMoney(summary.totalExpense, summary.currency)}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {!!summary.billCount && (
                <span className="rounded-full bg-slate-700/50 px-2.5 py-1 text-[11px] text-slate-300">
                  {t('bills', { count: summary.billCount })} · {formatMoney(summary.billTotalPreviewAmount, summary.currency)}
                </span>
              )}
              {balances && (
                <span className="rounded-full bg-emerald-500/10 px-2.5 py-1 text-[11px] text-emerald-400">
                  {t('balanceMatch')}
                </span>
              )}
            </div>
          </div>
        </>
      )}

      {warnings.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-amber-400/90">
          {warnings.map((w) => (
            <li key={w}>· {w}</li>
          ))}
        </ul>
      )}
    </ActionCardShell>
  );
}
