'use client';

import { useTranslations } from 'next-intl';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { useAssistantStore } from '@/lib/store';
import type { ConversationFile } from '@/types/assistant';
import { FileChip } from './file-chip';

interface ContextPanelProps {
  conversationId: string;
  files: ConversationFile[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ContextPanel({ conversationId, files, open, onOpenChange }: ContextPanelProps) {
  const t = useTranslations('assistant.context');
  const toggleFileActive = useAssistantStore((s) => s.toggleFileActive);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-80 border-slate-800 bg-slate-950 sm:max-w-80">
        <SheetHeader>
          <SheetTitle className="text-white">{t('title')}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-2.5 overflow-y-auto px-4 pb-4">
          {files.length === 0 && <p className="text-sm text-slate-500">{t('empty')}</p>}
          {files.map((file) => (
            <div key={file.id} className="space-y-1.5">
              <FileChip file={file} onRemove={() => toggleFileActive(conversationId, file.id)} />
              {file.active === false && (
                <p className="pl-1 text-[11px] text-slate-600">{t('outOfContext')}</p>
              )}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
