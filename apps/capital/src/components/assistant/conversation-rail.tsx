'use client';

import { useEffect } from 'react';
import { useTranslations, useLocale } from 'next-intl';
import { toast } from 'sonner';
import { Plus, MoreHorizontal, Trash2 } from 'lucide-react';
import { useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { useAssistantStore } from '@/lib/store';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import type { ConversationSummary } from '@/types/assistant';

interface ConversationRailProps {
  activeConversationId?: string;
  /** Set by the mobile drawer so picking anything closes the sheet behind it.
   *  Undefined on desktop, where the rail is always-on and has nothing to close. */
  onNavigate?: () => void;
}

function formatCreatedAt(createdAt: string, locale: string): string {
  const date = new Date(createdAt);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const sameYear = date.getFullYear() === now.getFullYear();

  if (sameDay) {
    return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(date);
  }
  if (sameYear) {
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
  }
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}

function groupConversations(conversations: ConversationSummary[]) {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const today: ConversationSummary[] = [];
  const last7: ConversationSummary[] = [];
  const older: ConversationSummary[] = [];

  for (const c of conversations) {
    const ageMs = now - new Date(c.lastMessageAt).getTime();
    if (ageMs < dayMs) today.push(c);
    else if (ageMs < 7 * dayMs) last7.push(c);
    else older.push(c);
  }
  return { today, last7, older };
}

export function ConversationRail({ activeConversationId, onNavigate }: ConversationRailProps) {
  const t = useTranslations('assistant');
  const locale = useLocale();
  const router = useRouter();
  const conversations = useAssistantStore((s) => s.conversations);
  const conversationsLoaded = useAssistantStore((s) => s.conversationsLoaded);
  const fetchConversations = useAssistantStore((s) => s.fetchConversations);
  const archiveConversation = useAssistantStore((s) => s.archiveConversation);

  useEffect(() => {
    if (!conversationsLoaded) void fetchConversations();
  }, [conversationsLoaded, fetchConversations]);

  // Just go to the index screen — the first message is what creates the
  // conversation (see assistant/page.tsx's handleSend). Creating one here
  // minted an empty orphan row for every click that never got typed into,
  // and was a second unguarded async path that could fail silently.
  const handleNew = () => {
    onNavigate?.();
    router.push('/assistant');
  };

  const handleSelect = (id: string) => {
    onNavigate?.();
    router.push(`/assistant/${id}`);
  };

  const handleDelete = async (id: string) => {
    await archiveConversation(id);
    const error = useAssistantStore.getState().error;
    if (error) {
      toast.error(error);
      return;
    }
    if (id === activeConversationId) {
      onNavigate?.();
      router.push('/assistant');
    }
  };

  const { today, last7, older } = groupConversations(conversations);

  const renderGroup = (label: string, items: ConversationSummary[]) => {
    if (items.length === 0) return null;
    return (
      <div className="flex flex-col gap-1" key={label}>
        <p className="mono mb-1 ml-2 text-[10px] uppercase tracking-wider text-slate-600">{label}</p>
        {items.map((c) => (
          <div
            key={c.id}
            className={cn(
              'group flex items-center justify-between rounded-lg px-3 py-2.5 hover:bg-slate-800/60',
              c.id === activeConversationId && 'bg-slate-800'
            )}
          >
            <button
              type="button"
              onClick={() => handleSelect(c.id)}
              className="min-w-0 flex-1 text-left"
            >
              <p
                className={cn(
                  'truncate text-sm',
                  c.id === activeConversationId ? 'font-medium text-white' : 'text-slate-300'
                )}
              >
                {c.title || t('untitled')}
              </p>
              <p className="truncate text-xs text-slate-600">{formatCreatedAt(c.createdAt, locale)}</p>
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger className="rounded p-2 text-slate-600 opacity-100 hover:bg-slate-700 hover:text-slate-300 md:p-1 md:opacity-0 md:group-hover:opacity-100">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="border-slate-700 bg-slate-900">
                <DropdownMenuItem
                  onClick={() => handleDelete(c.id)}
                  className="flex items-center gap-2 text-red-400 focus:text-red-400"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  {t('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="flex h-full w-full flex-col bg-slate-950 md:w-64 md:border-r md:border-slate-800">
      <div className="border-b border-slate-800 p-3">
        <button
          type="button"
          onClick={handleNew}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-700 py-2 text-sm font-medium text-slate-200 hover:bg-slate-800"
        >
          <Plus className="h-4 w-4" />
          {t('newConversation')}
        </button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-3">
        {conversations.length === 0 && conversationsLoaded && (
          <p className="mt-4 text-center text-xs text-slate-600">{t('emptyRail')}</p>
        )}
        {renderGroup(t('today'), today)}
        {renderGroup(t('last7Days'), last7)}
        {renderGroup(t('older'), older)}
      </div>
    </div>
  );
}
