'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowDown } from 'lucide-react';
import type { ChatMessage as ChatMessageData } from '@/types/assistant';
import { ChatMessage } from './chat-message';

interface ChatThreadProps {
  conversationId: string;
  messages: ChatMessageData[];
}

export function ChatThread({ conversationId, messages }: ChatThreadProps) {
  const t = useTranslations('assistant.thread');
  const containerRef = useRef<HTMLDivElement>(null);
  const [pinned, setPinned] = useState(true);

  useEffect(() => {
    if (!pinned || !containerRef.current) return;
    containerRef.current.scrollTop = containerRef.current.scrollHeight;
  }, [messages, pinned]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    setPinned(distanceFromBottom < 80);
  };

  const jumpToBottom = () => {
    setPinned(true);
    if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
  };

  return (
    <div className="relative flex-1 overflow-hidden">
      <div ref={containerRef} onScroll={handleScroll} className="h-full space-y-7 overflow-y-auto px-6 py-7 sm:px-8">
        {messages.map((message) => (
          <ChatMessage key={message.id} conversationId={conversationId} message={message} />
        ))}
      </div>
      {!pinned && (
        <button
          type="button"
          onClick={jumpToBottom}
          className="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-slate-700 bg-slate-800 px-3 py-1.5 text-xs text-slate-300 shadow-lg hover:bg-slate-700"
        >
          <ArrowDown className="h-3.5 w-3.5" />
          {t('jumpToBottom')}
        </button>
      )}
    </div>
  );
}
