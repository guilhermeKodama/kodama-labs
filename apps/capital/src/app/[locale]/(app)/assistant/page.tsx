'use client';

import { useRef, useState, type DragEvent } from 'react';
import { useTranslations } from 'next-intl';
import { Sparkles, FileUp, Copy, Undo2, ArrowUp, Paperclip, MessageCircleQuestion, X } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { useAssistantStore } from '@/lib/store';
import { ConversationRail } from '@/components/assistant/conversation-rail';
import { ConversationDrawer } from '@/components/assistant/conversation-drawer';
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
  const [sendError, setSendError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // A conversation created by an attempt that then failed downstream (upload,
  // stream) is reused on retry - otherwise every retry mints another empty
  // orphan row in the rail.
  const startedIdRef = useRef<string | null>(null);

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

  // Every exit path has to clear `starting` and, on failure, say why. Without
  // the try/finally a rejected fetch left `starting` true forever, which
  // disables the textarea and the send button with no message anywhere - the
  // composer just went dead and the user stayed on this screen.
  const handleSend = async () => {
    const value = text.trim();
    if ((!value && draftFiles.length === 0) || starting) return;
    setStarting(true);
    setSendError(null);
    try {
      const id = startedIdRef.current ?? (await createConversation());
      if (!id) {
        setSendError(useAssistantStore.getState().error ?? t('errors.startFailed'));
        return;
      }
      startedIdRef.current = id;

      let fileIds: string[] | undefined;
      if (draftFiles.length > 0) {
        const uploaded = await Promise.all(draftFiles.map((f) => uploadFile(id, f)));
        if (uploaded.some((f) => f === null)) {
          setSendError(useAssistantStore.getState().error ?? t('errors.uploadFailed'));
          return;
        }
        fileIds = uploaded.map((f) => f!.id);
      }

      void sendMessage(id, { text: value || undefined, fileIds });
      router.push(`/assistant/${id}`);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : t('errors.startFailed'));
    } finally {
      setStarting(false);
    }
  };

  const handleDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) addDraftFile(file);
  };

  return (
    <div className="flex h-full">
      <div className="hidden md:block">
        <ConversationRail />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* Phone header - the only way in to past conversations below md. */}
        <div className="flex h-14 flex-shrink-0 items-center gap-2 border-b border-slate-800 px-3 md:hidden">
          <ConversationDrawer />
          <h1 className="truncate text-[15px] font-semibold text-white">{t('title')}</h1>
        </div>

        {/* Scroll region: hero + shortcuts only. The composer is deliberately
            outside it - centring the whole column meant the send button moved
            as the textarea grew and again when the keyboard closed, so taps
            landed on empty space. `justify-center-safe` keeps the desktop
            centring without making overflowing content unreachable at the top. */}
        <div className="flex min-h-0 flex-1 flex-col items-center gap-8 overflow-y-auto px-6 pb-6 pt-8 md:justify-center-safe md:py-10">
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
        </div>

        <div className="flex-shrink-0 px-4 pb-4 md:px-6 md:pb-8">
          <div
            className="relative mx-auto w-full max-w-xl"
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
            {/* Above the composer, not a toast: sonner is bottom-anchored, so
                with the keyboard open it renders behind it - exactly when this
                fires. */}
            {sendError && (
              <div className="mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400">
                {sendError}
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
                        className="rounded-full p-1.5 text-slate-500 hover:bg-slate-700 hover:text-slate-200"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <Textarea
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  if (sendError) setSendError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={t('composer.placeholder')}
                disabled={starting}
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
                {/* preventDefault on pointerdown keeps the textarea focused, so
                    the soft keyboard never closes mid-tap and the layout can't
                    shift the button out from under the finger before `click`. */}
                <button
                  type="button"
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => void handleSend()}
                  disabled={(!text.trim() && draftFiles.length === 0) || starting}
                  aria-label={t('composer.send')}
                  className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-r from-emerald-500 to-cyan-500 text-white disabled:opacity-30 md:h-9 md:w-9"
                >
                  <ArrowUp className="h-4 w-4" />
                </button>
              </div>
            </div>
            {fileError && <p className="mt-1.5 text-xs text-red-400">{fileError}</p>}
          </div>
        </div>
      </div>
    </div>
  );
}
