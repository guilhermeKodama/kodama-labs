'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { FolderOpen } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import type { ConversationFile } from '@/types/assistant';
import { FileChip } from './file-chip';
import { ContextPanel } from './context-panel';

interface ContextStripProps {
  conversationId: string;
  files: ConversationFile[];
}

export function ContextStrip({ conversationId, files }: ContextStripProps) {
  const t = useTranslations('assistant.context');
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);

  if (files.length === 0) return null;

  // Three chips share ~200px on a phone once the "Contexto (n)" button has its
  // room - every filename would truncate to nothing. One chip plus a "+n"
  // counter says the same thing, and the panel behind the button has the rest.
  const visible = files.slice(0, isMobile ? 1 : 3);
  const overflow = files.length - visible.length;

  return (
    <div className="flex items-center gap-2 px-4 pb-2.5 md:px-8">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        {visible.map((f) => (
          <FileChip key={f.id} file={f} compact />
        ))}
        {overflow > 0 && <span className="flex-shrink-0 text-xs text-slate-500">+{overflow}</span>}
      </div>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs text-slate-500 hover:bg-slate-800 hover:text-slate-300"
      >
        <FolderOpen className="h-3.5 w-3.5" />
        {t('strip', { count: files.length })}
      </button>
      <ContextPanel conversationId={conversationId} files={files} open={open} onOpenChange={setOpen} />
    </div>
  );
}
