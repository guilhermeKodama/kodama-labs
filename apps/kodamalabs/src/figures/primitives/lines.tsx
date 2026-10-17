import type { SVGAttributes } from 'react';

type LineAttributes = Omit<SVGAttributes<SVGLineElement>, 'className' | 'x' | 'height' | 'from' | 'to'>;

interface SpineLineProps extends LineAttributes {
  x: number;
  height: number;
}

/**
 * The figure's own piece of the spine. On wide screens the page's spine runs
 * through the same place and this one steps aside; below that it is the only
 * spine there is.
 */
export function SpineLine({ x, height, ...rest }: SpineLineProps) {
  return <line data-part="spine" className="fig-spine wide:hidden" x1={x} y1={0} x2={x} y2={height} {...rest} />;
}

interface GateRuleProps extends LineAttributes {
  y: number;
  width: number;
}

/**
 * The spine of a narrow figure: a horizontal rule across the sheet, which the
 * flow crosses on its way down.
 */
export function GateRule({ y, width, ...rest }: GateRuleProps) {
  return <line data-part="spine" className="fig-spine" x1={0} y1={y} x2={width} y2={y} {...rest} />;
}

interface HairlineProps extends LineAttributes {
  from: readonly [number, number];
  to: readonly [number, number];
  dashed?: boolean;
}

/** A ruled line of a table or a panel. */
export function Hairline({ from, to, dashed = false, ...rest }: HairlineProps) {
  return (
    <line
      className={dashed ? 'fig-hairline-dashed' : 'fig-hairline'}
      x1={from[0]}
      y1={from[1]}
      x2={to[0]}
      y2={to[1]}
      {...rest}
    />
  );
}

interface PadProps {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Invisible geometry. It gives a group a box with a height (a lone horizontal
 * line has none) so the group can be clipped when it is animated, and it is
 * the hit area of a lane.
 */
export function Pad({ x, y, width, height }: PadProps) {
  return <rect className="fig-pad" x={x} y={y} width={width} height={height} />;
}
