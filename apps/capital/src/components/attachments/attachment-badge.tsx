'use client';

import { Paperclip } from 'lucide-react';
import { useAttachmentStore } from '@/lib/store/attachment-store';
import { cn } from '@/lib/utils';
import type { AttachmentOwnerType } from './attachment-uploader';

interface AttachmentBadgeProps {
  ownerType: AttachmentOwnerType;
  ownerId: string;
  onClick?: () => void;
  className?: string;
}

export function AttachmentBadge({
  ownerType,
  ownerId,
  onClick,
  className,
}: AttachmentBadgeProps) {
  const count = useAttachmentStore(
    (s) => (s.byOwner[ownerType][ownerId]?.length ?? 0),
  );

  if (count === 0) return null;

  const content = (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border border-slate-700 bg-slate-800/60 px-1.5 py-0.5 text-xs text-slate-300',
        onClick && 'cursor-pointer hover:bg-slate-700 hover:text-white',
        className,
      )}
    >
      <Paperclip className="h-3 w-3" />
      {count}
    </span>
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClick();
        }}
        className="inline-flex"
        aria-label={`${count} attachment${count === 1 ? '' : 's'}`}
      >
        {content}
      </button>
    );
  }

  return content;
}
