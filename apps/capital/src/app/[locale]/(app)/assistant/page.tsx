'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, FileUp, Copy, Undo2, ArrowUp, Paperclip, MessageCircleQuestion, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useAssistantStore } from '@/lib/store';
import { ConversationRail } from '@/components/assistant/conversation-rail';
import { SuggestedPrompts } from '@/components/assistant/suggested-prompts';
import { Textarea } from '@/components/ui/textarea';
import { ALLOWED_STATEMENT_EXTENSIONS, MAX_STATEMENT_FILE_BYTES } from '@/lib/assistant/constants';

export default function AssistantIndexPage() {
  const t = useTranslations('assistant');
  const router = useRouter();
  const createConversation = useAssistantStore((s) => s.createConversation);
  const uploadFile = useAssistantStore((s) => s.uploadFile);
  const sendMessage = useAssistantStore((s) => s.sendMessage);
  const [text, setText] = useState('');
  // Files picked before the conversation exists yet - stay attached to
  // this draft (visible as chips, removable) and are only uploaded once
  // the user actually sends. Picking a file must never by itself jump
  // the user into a conversation they haven't started.
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const [starting, setStarting] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addDraftFile = (file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase();
    if (!ext || !ALLOWED_STATEMENT_EXTENSIONS.includes(ext)) {
      setFileError(t('composer.fileTypeInvalid'));
      return;
    }
    if (file.size > MAX_STATEMENT_FILE_BYTES) {
      setFileError(t('composer.fileTooLarge', { max: '15MB' }));
      return;
    }
    setFileError(null);
    setDraftFiles((prev) => [...prev, file]);
  };

  const removeDraftFile = (index: number) => {
    setDraftFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSend = async () => {
    const value = text.trim();
    if ((!value && draftFiles.length === 0) || starting) return;
    setStarting(true);
    const id = await createConversation();
    if (id) {
      const uploaded = await Promise.all(draftFiles.map((f) => uploadFile(id, f)));
      const fileIds = uploaded.filter((f): f is NonNullable<typeof f> => f !== null).map((f) => f.id);
      void sendMessage(id, { text: value || undefined, fileIds: fileIds.length > 0 ? fileIds : undefined });
      router.push(`/assistant/${id}`);
    }
    setStarting(false);
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) addDraftFile(file);
  };

  return (
    <>
      <div className="flex h-full">
        <div className="hidden sm:block">
          <ConversationRail />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-8 overflow-y-auto px-6 py-10">
          <div className="flex max-w-lg flex-col items-center text-center">
            <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500">
              <Sparkles className="h-7 w-7 text-white" />
            </div>
            <h1 className="text-xl font-semibold text-white">{t('onboarding.headline')}</h1>
            <p className="mt-1.5 text-sm text-slate-400">{t('onboarding.subtitle')}</p>

            <div className="mt-6 w-full space-y-2.5 text-left">
              <div className="flex items-start gap-2.5 text-sm text-slate-300">
                <FileUp className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                {t('onboarding.capImport')}
              </div>
              <div className="flex items-start gap-2.5 text-sm text-slate-300">
                <MessageCircleQuestion className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                {t('onboarding.capQuestions')}
              </div>
              <div className="flex items-start gap-2.5 text-sm text-slate-300">
                <Copy className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                {t('onboarding.capDuplicates')}
              </div>
              <div className="flex items-start gap-2.5 text-sm text-slate-300">
                <Undo2 className="mt-0.5 h-4 w-4 flex-shrink-0 text-emerald-400" />
                {t('onboarding.capUndo')}
              </div>
            </div>
          </div>

          <div className="w-full max-w-xl">
            <SuggestedPrompts onFilePicked={addDraftFile} />
          </div>

          <div
            className="relative w-full max-w-xl"
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            {dragging && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl border-2 border-dashed border-emerald-500/50 bg-slate-950/90 text-sm text-emerald-400">
                {t('composer.dropHint')}
              </div>
            )}
            <div className="rounded-2xl border border-slate-700 bg-slate-900 px-2 pb-3 pt-2">
              {draftFiles.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5 px-2">
                  {draftFiles.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="flex items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 py-1 pl-2.5 pr-1.5 text-xs text-slate-300"
                    >
                      {f.name}
                      <button
                        type="button"
                        onClick={() => removeDraftFile(i)}
                        className="rounded-full p-0.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={t('composer.placeholder')}
                disabled={starting}
                className="min-h-[44px] resize-none border-0 bg-transparent text-[15px] leading-relaxed text-slate-200 shadow-none placeholder:text-slate-500 focus-visible:ring-0"
              />
              <div className="mt-1 flex items-center justify-between px-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs text-slate-400 hover:bg-slate-800 hover:text-slate-200"
                >
                  <Paperclip className="h-4 w-4" />
                  {t('composer.attach')}
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".ofx,.csv,.pdf"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) addDraftFile(file);
                    e.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={(!text.trim() && draftFiles.length === 0) || starting}
                  className="flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white disabled:opacity-30"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
            {fileError && <p className="mt-1.5 text-xs text-red-400">{fileError}</p>}
          </div>
        </div>
      </div>
    </>
  );
}
