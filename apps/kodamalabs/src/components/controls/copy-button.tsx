'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

import { QUIET_CONTROL } from './replay-button';

interface CopyButtonProps {
  /** The text put on the clipboard. */
  text: string;
  label: string;
  /** Shown for a moment once the text was copied. */
  done: string;
}

const never = () => () => undefined;

/** Copies a short text. It appears only where the browser can do it. */
export function CopyButton({ text, label, done }: CopyButtonProps) {
  // False on the server and until the page runs: no control that cannot work.
  const available = useSyncExternalStore(
    never,
    () => Boolean(navigator.clipboard),
    () => false,
  );
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);

  if (!available) return null;

  return (
    <button
      type="button"
      className={QUIET_CONTROL}
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      <span aria-live="polite">{copied ? done : label}</span>
    </button>
  );
}
