'use client';

import { useTranslations } from 'next-intl';
import { Loader2, Check, AlertTriangle, FileText } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ConversationFile } from '@/types/assistant';

const TYPE_STYLES: Record<ConversationFile['fileType'], string> = {
  ofx: 'bg-blue-500/15 text-blue-400',
  csv: 'bg-amber-500/15 text-amber-400',
  pdf: 'bg-red-500/15 text-red-400',
};

interface FileChipProps {
  file: ConversationFile;
  onRemove?: () => void;
  compact?: boolean;
}

export function FileChip({ file, onRemove, compact = false }: FileChipProps) {
  const t = useTranslations('assistant.context.status');

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-2.5 py-1.5',
        file.parseStatus === 'failed'
          ? 'border-red-500/30 bg-red-500/5'
          : 'border-slate-700 bg-slate-800/50',
        compact && 'py-1'
      )}
    >
      <span
        className={cn(
          'mono flex-shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium tracking-wide',
          TYPE_STYLES[file.fileType]
        )}
      >
        {file.fileType.toUpperCase()}
      </span>
      <div className="min-w-0">
        <p className="truncate text-xs text-slate-200">{file.originalName}</p>
        {!compact && (
          <p className="flex items-center gap-1 text-[11px] text-slate-500">
            {file.parseStatus === 'pending' && (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> {t('uploading')}
              </>
            )}
            {file.parseStatus === 'parsed' && file.fileType !== 'pdf' && (
              <>
                <Check className="h-3 w-3 text-emerald-400" />{' '}
                {t('ready', { count: file.rowCount ?? 0 })}
              </>
            )}
            {file.parseStatus === 'not_applicable' && (
              <>
                <FileText className="h-3 w-3" /> {t('notApplicable')}
              </>
            )}
            {file.parseStatus === 'failed' && (
              <span className="text-red-400">
                <AlertTriangle className="mr-1 inline h-3 w-3" />
                {t('error')}
              </span>
            )}
          </p>
        )}
      </div>
      {onRemove && (
        <button
          type="button"
          onClick={onRemove}
          className="ml-1 flex-shrink-0 text-[11px] text-slate-500 hover:text-slate-300"
        >
          ×
        </button>
      )}
    </div>
  );
}
