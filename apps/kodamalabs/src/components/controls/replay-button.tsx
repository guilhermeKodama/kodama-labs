'use client';

import type { MotionApi } from '@/motion/controller';

/** Shared look of the small mono controls that sit beside a figure or in the footer. */
export const QUIET_CONTROL =
  'cursor-pointer font-mono text-label text-muted underline decoration-1 underline-offset-4 hover:decoration-2';

interface ReplayButtonProps {
  /** Ids of the figures to play again (their `data-fig`). */
  figures: readonly string[];
  label: string;
}

/**
 * Plays a figure again from its first frame. It exists only for a visit that
 * has motion (`m-only`): without it there is nothing to replay.
 */
export function ReplayButton({ figures, label }: ReplayButtonProps) {
  return (
    <button
      type="button"
      className={`m-only ${QUIET_CONTROL}`}
      onClick={() => {
        const motion = window.__m as MotionApi | undefined;
        for (const figure of figures) motion?.replay(figure);
      }}
    >
      {label}
    </button>
  );
}
