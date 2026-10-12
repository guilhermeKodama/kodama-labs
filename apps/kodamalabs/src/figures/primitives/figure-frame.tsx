import type { Sheet } from '../geometry/grid';

interface FigureFrameProps {
  /**
   * Stable name of the figure, and the id of its timeline in src/motion.
   * Left out by a figure that plays in several acts: each act is then a group
   * with its own timeline inside the sheet.
   */
  id?: string;
  sheet: Sheet;
  height: number;
  /** One or two sentences that say what the drawing shows. */
  alt: string;
  /** True when the figure contains links; it is then a group, not an image. */
  interactive?: boolean;
  children: React.ReactNode;
}

/**
 * The SVG sheet of a figure. It scales with its column. Below the `wide`
 * breakpoint it keeps a readable minimum width and scrolls sideways in its
 * box, until the figure has a vertical variant.
 */
export function FigureFrame({ id, sheet, height, alt, interactive = false, children }: FigureFrameProps) {
  const minWidth = sheet.width === 1200 ? 'min-w-[900px]' : 'min-w-[660px]';

  return (
    <div className="overflow-x-auto wide:overflow-visible">
      <svg
        viewBox={`0 0 ${sheet.width} ${height}`}
        role={interactive ? 'group' : 'img'}
        aria-label={alt}
        // Rendered waiting; the motion scripts move it on (see src/motion/verbs.css).
        {...(id ? { 'data-fig': id, 'data-state': 'idle', suppressHydrationWarning: true } : {})}
        className={`block h-auto w-full ${minWidth} wide:min-w-0`}
      >
        {children}
      </svg>
    </div>
  );
}
