'use client';

import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface FormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  className?: string;
  children: ReactNode;
}

/**
 * Shared shell for every create/edit dialog: title, optional description,
 * scroll handling for tall forms. Entity dialogs supply only their copy and
 * form — this owns the chrome so it can't drift out of sync between dialogs
 * one at a time.
 *
 * Renders as a bottom Drawer on mobile (a fixed centered modal is awkward
 * to reach and to scroll one-handed) and a centered Dialog on desktop —
 * same props either way, so none of this dialog's callers need to know
 * which one they got.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  className,
  children,
}: FormDialogProps) {
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        {/* The variant-scoped selector (not a bare max-h-*) is required so
            twMerge recognizes this as overriding drawer.tsx's own
            data-[vaul-drawer-direction=bottom]:max-h-[80vh] default — a
            bare max-h-[92dvh] survives the merge as a separate class but
            loses the cascade to the more specific one and never applies. */}
        <DrawerContent className="data-[vaul-drawer-direction=bottom]:max-h-[92dvh]">
          <DrawerHeader className="text-left">
            <DrawerTitle>{title}</DrawerTitle>
            {description && <DrawerDescription>{description}</DrawerDescription>}
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
            {children}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn('max-h-[90dvh] overflow-y-auto sm:max-w-lg', className)}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
