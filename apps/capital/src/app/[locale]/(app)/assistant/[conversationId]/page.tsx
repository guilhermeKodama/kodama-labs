'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { useAssistantStore } from '@/lib/store';
import { ConversationRail } from '@/components/assistant/conversation-rail';
import { ChatThread } from '@/components/assistant/chat-thread';
import { ChatComposer } from '@/components/assistant/chat-composer';
import { ContextStrip } from '@/components/assistant/context-strip';
import type { ChatMessage as ChatMessageData, ConversationFile } from '@/types/assistant';

// Stable references for the "not loaded yet" case - a fresh `?? []`
// literal inside the selector would return a new array identity on
// every call, which trips useSyncExternalStore's "getSnapshot should be
// cached" infinite-loop guard even though the underlying store data
// hasn't changed.
const EMPTY_MESSAGES: ChatMessageData[] = [];
const EMPTY_FILES: ConversationFile[] = [];

export default function AssistantConversationPage() {
  const params = useParams<{ conversationId: string }>();
  const conversationId = params.conversationId;
  const t = useTranslations('assistant');

  const conversations = useAssistantStore((s) => s.conversations);
  const conversationsLoaded = useAssistantStore((s) => s.conversationsLoaded);
  const fetchConversations = useAssistantStore((s) => s.fetchConversations);
  const loadedConversations = useAssistantStore((s) => s.loadedConversations);
  const fetchConversation = useAssistantStore((s) => s.fetchConversation);
  const messages = useAssistantStore((s) => s.messagesByConversation[conversationId] ?? EMPTY_MESSAGES);
  const files = useAssistantStore((s) => s.filesByConversation[conversationId] ?? EMPTY_FILES);
  const turnRunning = useAssistantStore((s) => s.turnRunning[conversationId] ?? false);
  const turnError = useAssistantStore((s) => s.turnErrorByConversation[conversationId]);

  useEffect(() => {
    if (!conversationsLoaded) void fetchConversations();
  }, [conversationsLoaded, fetchConversations]);

  useEffect(() => {
    // Skip refetching if a send-message flow already populated this
    // conversation's messages (e.g. just created from the index page and
    // still mid-stream) - a GET here would clobber the live state with a
    // stale snapshot from before the turn started.
    if (!loadedConversations[conversationId] && messages.length === 0) {
      void fetchConversation(conversationId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId]);

  const activeFiles = files.filter((f) => f.active !== false);
  const conversation = conversations.find((c) => c.id === conversationId);

  return (
    <>
      <div className="flex h-full">
        <div className="hidden sm:block">
          <ConversationRail activeConversationId={conversationId} />
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-16 flex-shrink-0 items-center gap-2 border-b border-slate-800 px-4 sm:px-8">
            <Link href="/assistant" className="rounded p-1.5 text-slate-400 hover:bg-slate-800 sm:hidden">
              <ChevronLeft className="h-4 w-4" />
            </Link>
            <h1 className="truncate text-[15px] font-semibold text-white">
              {conversation?.title || t('untitled')}
            </h1>
          </div>

          <ChatThread conversationId={conversationId} messages={messages} />

          {turnError && (
            <div className="mx-6 mb-2 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-400 sm:mx-8">
              {turnError}
            </div>
          )}

          <ContextStrip conversationId={conversationId} files={activeFiles} />
          <ChatComposer conversationId={conversationId} turnRunning={turnRunning} />
        </div>
      </div>
    </>
  );
}
