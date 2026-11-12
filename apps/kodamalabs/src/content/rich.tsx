import type { ReactNode } from 'react';

import type { MotionProps } from '@/motion/timeline';

/**
 * The words that point at the spine, underlined in the accent. The underline
 * is an element so it can be drawn in; `motion` is its place in a timeline.
 */
export function SpineWords({ children, motion }: { children: ReactNode; motion?: MotionProps }) {
  return (
    <span className="relative pb-px whitespace-nowrap">
      {children}
      <span
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-full h-[1.5px] bg-accent"
        {...motion}
      />
    </span>
  );
}

/**
 * The whole rich-text vocabulary of the message files, for `t.rich`:
 *
 *   <head>…</head>  a bold run-in head ("Must not happen.")
 *   <line>…</line>  the words that point at the spine, underlined in the accent
 */
export const RICH = {
  head: (chunks: ReactNode) => <b className="font-semibold">{chunks}</b>,
  line: (chunks: ReactNode) => <SpineWords>{chunks}</SpineWords>,
};
