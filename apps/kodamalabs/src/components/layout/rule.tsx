import type { MotionProps } from '@/motion/timeline';

interface RuleProps extends Partial<MotionProps> {
  /** `top`: along the top edge of the block. `below`: just under its bottom edge. */
  edge?: 'top' | 'below';
}

/**
 * A hairline of a ruled block, as an element of its own so it can be drawn in
 * (a border cannot). It lies on the nearest positioned ancestor, which leaves
 * it one pixel of padding where the border would have been.
 */
export function Rule({ edge = 'top', ...motion }: RuleProps) {
  const position = edge === 'top' ? 'top-0' : 'top-full';

  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute inset-x-0 h-px bg-rule ${position}`}
      {...motion}
    />
  );
}
