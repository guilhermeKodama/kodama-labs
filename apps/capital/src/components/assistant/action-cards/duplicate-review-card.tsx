'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Copy } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useAssistantStore } from '@/lib/store';
import type { DuplicateReviewCard as DuplicateReviewCardData } from '@/types/assistant';
import { ConfidenceBadge } from '../confidence-badge';
import { ActionCardShell } from './action-card-shell';

type Decision = 'keep_both' | 'merge' | 'skip';

interface DuplicateReviewCardProps {
  conversationId: string;
  card: DuplicateReviewCardData;
}

function money(value: number) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(value);
}

export function DuplicateReviewCard({ conversationId, card }: DuplicateReviewCardProps) {
  const t = useTranslations('assistant.cards.duplicates');
  const tCommon = useTranslations('assistant.cards.common');
  const tConfidence = useTranslations('assistant.cards.duplicates.confidence');
  const sendMessage = useAssistantStore((s) => s.sendMessage);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [submitting, setSubmitting] = useState(false);
  const [locked, setLocked] = useState(card.status === 'answered');

  const decisionLabel: Record<Decision, string> = {
    keep_both: t('keepBoth'),
    merge: t('merge'),
    skip: t('skip'),
  };

  const allDecided = card.pairs.every((p) => decisions[p.pairId]);

  const handleSubmit = async () => {
    setSubmitting(true);
    await sendMessage(conversationId, {
      cardResponse: {
        cardId: card.cardId,
        decisions: card.pairs.map((p) => ({
          pairId: p.pairId,
          label: decisionLabel[decisions[p.pairId] ?? 'keep_both'],
        })),
      },
    });
    setSubmitting(false);
    setLocked(true);
  };

  return (
    <ActionCardShell
      icon={<Copy className="h-[18px] w-[18px]" />}
      title={t('title')}
      locked={locked}
      footer={
        locked ? (
          <span className="text-xs text-slate-500">{tCommon('decided', { decision: '', time: '' })}</span>
        ) : (
          <div className="flex justify-end">
            <Button
              size="sm"
              disabled={!allDecided || submitting}
              onClick={handleSubmit}
              className="bg-gradient-to-r from-emerald-500 to-cyan-500 text-white hover:opacity-90"
            >
              {tCommon('confirmSelections')}
            </Button>
          </div>
        )
      }
    >
      <p className="mb-3.5 text-sm text-slate-400">{t('description', { count: card.pairs.length })}</p>
      <div className="space-y-4">
        {card.pairs.map((pair) => (
          <div key={pair.pairId} className="rounded-xl border border-slate-800 p-3.5">
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <ConfidenceBadge confidence={pair.confidence} label={tConfidence(pair.confidence)} />
              <span className="text-[11px] text-slate-500">{pair.reason}</span>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="rounded-lg border border-blue-500/25 bg-blue-500/5 p-2.5">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-blue-400">
                  {t('fromStatement')}
                </p>
                <p className="truncate text-sm text-slate-200">{pair.incoming.description}</p>
                <p className="mono mt-0.5 text-xs text-slate-500">
                  {pair.incoming.date} ·{' '}
                  <span className={pair.incoming.type === 'income' ? 'text-emerald-400' : 'text-red-400'}>
                    {money(pair.incoming.amount)}
                  </span>
                </p>
              </div>
              <div className="rounded-lg border border-purple-500/25 bg-purple-500/5 p-2.5">
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-purple-400">
                  {t('existingEntry')}
                </p>
                <p className="truncate text-sm text-slate-200">{pair.existing.description}</p>
                <p className="mono mt-0.5 text-xs text-slate-500">
                  {pair.existing.date} ·{' '}
                  <span className={pair.existing.type === 'income' ? 'text-emerald-400' : 'text-red-400'}>
                    {money(pair.existing.amount)}
                  </span>
                </p>
              </div>
            </div>
            <div className="mt-2.5 flex gap-1.5">
              {(['keep_both', 'merge', 'skip'] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={locked}
                  onClick={() => setDecisions((prev) => ({ ...prev, [pair.pairId]: d }))}
                  className={cn(
                    'flex-1 rounded-lg border py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
                    decisions[pair.pairId] === d
                      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
                      : 'border-slate-700 text-slate-300 hover:border-slate-600'
                  )}
                >
                  {decisionLabel[d]}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </ActionCardShell>
  );
}
