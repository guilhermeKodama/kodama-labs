'use client';

import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';

interface ModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
  className?: string;
}

export function Modal({ open, onOpenChange, children, className }: ModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onOpenChange(false);
      }
    };

    if (open) {
      document.addEventListener('keydown', handleEscape);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = 'unset';
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
      document.body.style.overflow = 'unset';
    };
  }, [open, onOpenChange]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/50 backdrop-blur-sm"
        onClick={() => onOpenChange(false)}
      />
      
      {/* Modal Content */}
      <div
        ref={modalRef}
        className={cn(
          "relative z-50 w-full max-w-md mx-4 bg-background border rounded-lg shadow-lg",
          "animate-in fade-in-0 zoom-in-95 duration-200",
          className
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

interface ModalHeaderProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalHeader({ children, className }: ModalHeaderProps) {
  return (
    <div className={cn("flex flex-col space-y-1.5 p-6 pb-4", className)}>
      {children}
    </div>
  );
}

interface ModalTitleProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalTitle({ children, className }: ModalTitleProps) {
  return (
    <h2 className={cn("text-lg font-semibold leading-none tracking-tight", className)}>
      {children}
    </h2>
  );
}

interface ModalDescriptionProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalDescription({ children, className }: ModalDescriptionProps) {
  return (
    <p className={cn("text-sm text-muted-foreground", className)}>
      {children}
    </p>
  );
}

interface ModalContentProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalContent({ children, className }: ModalContentProps) {
  return (
    <div className={cn("p-6 pt-0", className)}>
      {children}
    </div>
  );
}

interface ModalFooterProps {
  children: React.ReactNode;
  className?: string;
}

export function ModalFooter({ children, className }: ModalFooterProps) {
  return (
    <div className={cn("flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2 p-6 pt-0", className)}>
      {children}
    </div>
  );
}

interface ModalCloseProps {
  onClose: () => void;
  className?: string;
}

export function ModalClose({ onClose, className }: ModalCloseProps) {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClose}
      className={cn("absolute right-4 top-4 h-8 w-8 p-0", className)}
    >
      <X className="h-4 w-4" />
      <span className="sr-only">Close</span>
    </Button>
  );
}
