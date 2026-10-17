import { NARROW, type Sheet } from '../geometry/grid';

type FigureFrameProps = {
  /**
   * Stable name of the figure, and the id of its timeline in src/motion.
   * Left out by a figure that plays in several acts: each act is then a group
   * with its own timeline inside the sheet.
   */
  id?: string;
  height: number;
  /** One or two sentences that say what the drawing shows. */
  alt: string;
  /** True when the figure contains links; it is then a group, not an image. */
  interactive?: boolean;
  children: React.ReactNode;
} & (
  | { sheet: Sheet }
  // The narrow drawing of a figure, and the sheet of the wide one it stands in for.
  | { sheet: typeof NARROW; beside: Sheet }
);

/**
 * When each drawing of a figure is shown. A 1200-unit figure needs the `wide`
 * breakpoint to be legible; a strip figure is legible from `nav` up. Below
 * that the narrow drawing takes its place, at about the size it was drawn.
 */
const SHOWN = {
  1200: { wide: 'hidden wide:block', narrow: 'max-w-[440px] wide:hidden' },
  792: { wide: 'hidden max-w-[792px] nav:block', narrow: 'max-w-[440px] nav:hidden' },
} as const;

/**
 * The SVG sheet of a figure. It scales with its column. A figure is drawn
 * twice, wide and narrow, and CSS shows the one that fits; the other takes no
 * space and does not play.
 */
export function FigureFrame({ id, height, alt, interactive = false, children, ...props }: FigureFrameProps) {
  const shown = 'beside' in props ? SHOWN[props.beside.width].narrow : SHOWN[props.sheet.width].wide;

  return (
    <div className={shown}>
      <svg
        viewBox={`0 0 ${props.sheet.width} ${height}`}
        role={interactive ? 'group' : 'img'}
        aria-label={alt}
        // Rendered waiting; the motion scripts move it on (see src/motion/verbs.css).
        {...(id ? { 'data-fig': id, 'data-state': 'idle', suppressHydrationWarning: true } : {})}
        className="block h-auto w-full"
      >
        {children}
      </svg>
    </div>
  );
}
