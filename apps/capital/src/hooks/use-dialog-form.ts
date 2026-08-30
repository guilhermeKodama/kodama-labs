'use client';

import { useCallback, useState } from 'react';
import { toast } from 'sonner';

interface UseDialogFormOptions<T, R> {
  /** Closes the owning dialog; called only when `action` resolves truthy. */
  onOpenChange: (open: boolean) => void;
  /** The async store call. Must resolve falsy (null/false/undefined) on failure. */
  action: (data: T) => Promise<R>;
  /** Runs after a successful submit, once the dialog has been closed. */
  onSuccess?: (result: NonNullable<R>, data: T) => void;
  /** Shown via toast.error when `action` resolves falsy. Omit to handle errors yourself. */
  errorMessage?: string;
}

/**
 * Standard behavior for a create/edit dialog backed by an async store action:
 * tracks a submitting flag for the dialog's loading state, and closes the
 * dialog only when the action resolves truthy — the store's standard
 * "it failed" signal (a falsy result) leaves the dialog open so the user can
 * see the error and retry, instead of the dialog closing regardless of outcome.
 */
export function useDialogForm<T, R>({
  onOpenChange,
  action,
  onSuccess,
  errorMessage,
}: UseDialogFormOptions<T, R>) {
  const [isSubmitting, setIsSubmitting] = useState(false);

  const submit = useCallback(
    async (data: T) => {
      setIsSubmitting(true);
      try {
        const result = await action(data);
        if (result) {
          onOpenChange(false);
          onSuccess?.(result as NonNullable<R>, data);
        } else if (errorMessage) {
          toast.error(errorMessage);
        }
        return result;
      } finally {
        setIsSubmitting(false);
      }
    },
    [action, onOpenChange, onSuccess, errorMessage]
  );

  return { submit, isSubmitting };
}
