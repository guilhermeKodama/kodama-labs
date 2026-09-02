'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PanelLeft } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ConversationRail } from './conversation-rail';

interface ConversationDrawerProps {
  activeConversationId?: string;
}

/**
 * Phone/tablet access to the conversation list. Below `md` the rail is hidden
 * (the sidebar/bottom-nav breakpoint), which used to leave past conversations
 * completely unreachable — the only assistant screen a phone could get to was
 * the empty onboarding one, so the feature read as "always a new conversation".
 *
 * Wraps the same `ConversationRail` the desktop uses rather than a second list;
 * `onNavigate` closes the sheet once the rail has routed somewhere.
 */
export function ConversationDrawer({ activeConversationId }: ConversationDrawerProps) {
  const t = useTranslations('assistant');
  const [open, setOpen] = useState(false);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* Not SheetTrigger: Radix's trigger renders its own <button>, and we
          want the 44px touch target and md:hidden on the element itself. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('backToList')}
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-800 hover:text-slate-200 md:hidden"
      >
        <PanelLeft className="h-5 w-5" />
      </button>
      <SheetContent
        side="left"
        className="w-[85%] gap-0 border-slate-800 bg-slate-950 p-0 sm:max-w-xs"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('title')}</SheetTitle>
        </SheetHeader>
        <ConversationRail
          activeConversationId={activeConversationId}
          onNavigate={() => setOpen(false)}
        />
      </SheetContent>
    </Sheet>
  );
}
