'use client';

import type { ReactNode } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
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
 * Shared shell for every create/edit dialog: fixed dark styling, title,
 * optional description, scroll handling for tall forms. Entity dialogs
 * supply only their copy and form — this owns the chrome so it can't drift
 * out of sync between dialogs one at a time.
 */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  className,
  children,
}: FormDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          'max-h-[90vh] overflow-y-auto border-slate-800 bg-slate-900 sm:max-w-lg',
          className
        )}
      >
        <DialogHeader>
          <DialogTitle className="text-white">{title}</DialogTitle>
          {description && (
            <DialogDescription className="text-slate-400">{description}</DialogDescription>
          )}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
