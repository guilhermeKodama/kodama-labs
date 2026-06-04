'use client';

import { motion } from 'framer-motion';

import { LogoMark } from './logo-mark';
import { cn } from '@/lib/utils';

interface WordmarkProps {
  className?: string;
  /** Pixel size of the mark; the wordmark scales relative to this. Default 22. */
  size?: number;
  /** Hide the "Kodama Labs" text — only render the mark. */
  markOnly?: boolean;
}

/**
 * Brand lockup: the lens mark + "Kodama Labs" wordmark. Animates a subtle 45°
 * rotation on hover — the "click into the next observation" feel that fits a
 * studio of one tinkering with instruments.
 */
export function Wordmark({ className, size = 22, markOnly = false }: WordmarkProps) {
  return (
    <span className={cn('group inline-flex items-center gap-2.5', className)}>
      <motion.span
        whileHover={{ rotate: 12 }}
        transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="inline-flex"
        style={{
          // Pivot from the compass head (top center, ~18.75% down the viewBox)
          // so the legs swing instead of the whole mark tumbling.
          originX: 0.5,
          originY: 0.1875,
          filter: 'drop-shadow(0 0 8px oklch(0.7 0.18 160 / 0.55))',
        }}
      >
        <LogoMark size={size} />
      </motion.span>
      {markOnly ? null : (
        <span className="text-sm font-semibold tracking-tight">
          Kodama Labs
        </span>
      )}
    </span>
  );
}
