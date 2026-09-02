'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Paperclip, ArrowUp, Square } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { useAssistantStore } from '@/lib/store';
import {
  ASSISTANT_FILE_ACCEPT,
  namePastedImage,
  validateAssistantFile,
} from '@/lib/assistant/constants';

interface ChatComposerProps {
  conversationId: string;
  turnRunning: boolean;
}

export function ChatComposer({ conversationId, turnRunning }: ChatComposerProps) {
  const t = useTranslations('assistant.composer');
  const tErrors = useTranslations('assistant.errors');
  const sendMessage = useAssistantStore((s) => s.sendMessage);
  const uploadFile = useAssistantStore((s) => s.uploadFile);
  const cancelTurn = useAssistantStore((s) => s.cancelTurn);

  const [text, setText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | File[]) => {
    setFileError(null);
    for (const raw of Array.from(files)) {
      const file = namePastedImage(raw, Date.now());
      const rejection = validateAssistantFile(file);
      if (rejection) {
        setFileError(
          rejection.reason === 'type'
            ? t('fileTypeInvalid')
            : t('fileTooLarge', { max: rejection.maxLabel })
        );
        continue;
      }
      // uploadFile resolves to null on failure and records why in the store -
      // without this the file just silently never appeared in the context.
      if ((await uploadFile(conversationId, file)) === null) {
        setFileError(useAssistantStore.getState().error ?? tErrors('uploadFailed'));
      }
    }
  };

  // Pasting a screenshot is the primary way images get here - Ctrl+V
  // straight into the composer, no file picker.
  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length === 0) return;
    e.preventDefault();
    void handleFiles(files);
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
      className="relative flex-shrink-0 px-4 pb-4 md:px-8 md:pb-6"
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={handleDrop}
    >
      {dragging && (
        <div className="absolute inset-x-4 inset-y-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-emerald-500/50 bg-slate-950/90 text-sm text-emerald-400 md:inset-x-8">
          {t('dropHint')}
        </div>
      )}
      <div className="rounded-2xl border border-slate-700 bg-slate-900 px-2 pb-3 pt-2">
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          placeholder={t('placeholder')}
          disabled={turnRunning}
          enterKeyHint="send"
          className="max-h-40 min-h-[44px] resize-none border-0 bg-transparent text-[15px] leading-relaxed text-slate-200 shadow-none placeholder:text-slate-500 focus-visible:ring-0"
        />
        <div className="mt-1 flex items-center justify-between px-2">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 rounded-lg px-3 py-2.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200 md:py-1.5"
          >
            <Paperclip className="h-4 w-4" />
            {t('attach')}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={ASSISTANT_FILE_ACCEPT}
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) void handleFiles(e.target.files);
              e.target.value = '';
            }}
          />
          {turnRunning ? (
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => void cancelTurn(conversationId)}
              className="flex items-center gap-1.5 rounded-lg border border-slate-600 px-3 py-2.5 text-xs font-medium text-slate-200 hover:bg-slate-800 md:py-1.5"
            >
              <Square className="h-3 w-3 fill-current" />
              {t('stop')}
            </button>
          ) : (
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={handleSend}
              disabled={!text.trim()}
              aria-label={t('send')}
              className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white disabled:opacity-30 md:h-9 md:w-9"
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
