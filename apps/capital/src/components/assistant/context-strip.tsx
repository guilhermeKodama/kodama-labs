'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderOpen } from 'lucide-react';
import type { ConversationFile } from '@/types/assistant';
import { FileChip } from './file-chip';
import { ContextPanel } from './context-panel';

interface ContextStripProps {
  conversationId: string;
  files: ConversationFile[];
}

export function ContextStrip({ conversationId, files }: ContextStripProps) {
  const t = useTranslations('assistant.context');
  const [open, setOpen] = useState(false);

  if (files.length === 0) return null;

  const visible = files.slice(0, 3);
  const overflow = files.length - visible.length;

  return (
    <div className="flex items-center gap-2 px-6 pb-2.5 sm:px-8">
      {visible.map((f) => (
        <FileChip key={f.id} file={f} compact />
      ))}
      {overflow > 0 && <span className="text-xs text-slate-500">+{overflow}</span>}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="ml-1 flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        {t('strip', { count: files.length })}
      </button>
      <ContextPanel conversationId={conversationId} files={files} open={open} onOpenChange={setOpen} />
    </div>
  );
}
