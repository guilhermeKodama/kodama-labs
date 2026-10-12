interface FigureSlotProps {
  /** Size of the drawing in its own units (the viewBox of the mockup figure). */
  width: 1200 | 792;
  height: number;
  alt: string;
}

/**
 * Stand-in for a figure that is not drawn yet: an outlined box of the exact
 * proportions, carrying the figure's description. Replaced figure by figure.
 *
 * Below the `wide` breakpoint a wide drawing scrolls sideways in its box until
 * the vertical variants exist.
 */
export function FigureSlot({ width, height, alt }: FigureSlotProps) {
  const minWidth = width === 1200 ? 'min-w-[900px]' : 'min-w-[660px]';

  return (
    <div className="overflow-x-auto wide:overflow-visible">
      <div
        role="img"
        aria-label={alt}
        style={{ aspectRatio: `${width} / ${height}` }}
        className={`${minWidth} border border-dashed border-rule wide:min-w-0`}
      />
    </div>
  );
}
