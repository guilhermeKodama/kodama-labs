import type { ReactNode } from 'react';

interface StatusLineProps {
  /** Segments in order. A segment that is null was built on an unknown fact. */
  segments: Array<ReactNode | null>;
  className?: string;
}

const SEPARATOR = ' · ';

/**
 * A dated status in mono, its segments joined by middle dots. Segments whose
 * fact is unknown are dropped, and the line disappears when none are left.
 */
export function StatusLine({ segments, className = '' }: StatusLineProps) {
  const shown = segments.filter((segment) => segment !== null);
  if (shown.length === 0) return null;

  return (
    <p className={`font-mono text-status text-muted first-letter:uppercase ${className}`}>
      {shown.map((segment, index) => (
        <span key={index}>
          {index > 0 ? SEPARATOR : null}
          {segment}
        </span>
      ))}
    </p>
  );
}
