'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip, ArrowUp, Square } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useAssistantStore } from '@/lib/store';
import { MAX_STATEMENT_FILE_BYTES, ALLOWED_STATEMENT_EXTENSIONS } from '@/lib/assistant/constants';

interface ChatComposerProps {
  conversationId: string;
  turnRunning: boolean;
}

export function ChatComposer({ conversationId, turnRunning }: ChatComposerProps) {
  const t = useTranslations('assistant.composer');
  const sendMessage = useAssistantStore((s) => s.sendMessage);
  const uploadFile = useAssistantStore((s) => s.uploadFile);
  const cancelTurn = useAssistantStore((s) => s.cancelTurn);

  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    setFileError(null);
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase();
      if (!ext || !ALLOWED_STATEMENT_EXTENSIONS.includes(ext)) {
        setFileError(t('fileTypeInvalid'));
        continue;
      }
      if (file.size > MAX_STATEMENT_FILE_BYTES) {
        setFileError(t('fileTooLarge', { max: '15MB' }));
        continue;
      }
      await uploadFile(conversationId, file);
    }
  };

  const handleSend = () => {
    if (turnRunning || !text.trim()) return;
    void sendMessage(conversationId, { text: text.trim() });
    setText('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) void handleFiles(e.dataTransfer.files);
  };

  return (
    <div
      className="relative px-6 pb-6 sm:px-8"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="absolute inset-x-6 inset-y-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-emerald-500/50 bg-slate-950/90 text-sm text-emerald-400 sm:inset-x-8">
          {t('dropHint')}
        </div>
      )}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 px-2 pb-3 pt-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('placeholder')}
          disabled={turnRunning}
          className="min-h-[44px] resize-none border-0 bg-transparent text-[15px] leading-relaxed text-slate-200 shadow-none placeholder:text-slate-500 focus-visible:ring-0"
        />
        <div className="mt-1 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
          >
            <Paperclip className="h-4 w-4" />
            {t('attach')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".ofx,.csv,.pdf"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {turnRunning ? (
            <button
              type="button"
              onClick={() => void cancelTurn(conversationId)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-1.5 text-xs font-medium text-slate-200 hover:bg-slate-800"
            >
              <Square className="h-3 w-3 fill-current" />
              {t('stop')}
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSend}
              disabled={!text.trim()}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white disabled:opacity-30"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {fileError && <p className="mt-1.5 text-xs text-red-400">{fileError}</p>}
    </div>
  );
}
