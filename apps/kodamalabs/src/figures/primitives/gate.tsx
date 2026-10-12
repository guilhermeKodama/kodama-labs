import type { SVGAttributes } from 'react';

/**
 * dot      a decision by a person, or a single check
 * bar      an evaluator many proposals run into
 * ring     waiting: nothing has been decided yet
 * band     a window with a duration
 * capsule  an evaluator drawn open, with candidates arriving along it
 */
export type GateShape = 'dot' | 'bar' | 'ring' | 'band' | 'capsule';

interface GateProps extends Omit<SVGAttributes<SVGElement>, 'x' | 'y' | 'height' | 'className'> {
  shape: GateShape;
  /** Centre of the mark. `x` is always the figure's spine. */
  x: number;
  y: number;
  /** Extent along the spine, for bar and capsule. */
  height?: number;
}

/** The only accent in a figure: where a person or a fail-closed check decides. */
export function Gate({ shape, x, y, height = 26, ...rest }: GateProps) {
  switch (shape) {
    case 'dot':
      return <circle data-part="gate" className="fig-gate" cx={x} cy={y} r={6.5} {...rest} />;
    case 'ring':
      return <circle data-part="gate" className="fig-gate-open" cx={x} cy={y} r={6} {...rest} />;
    case 'bar':
      return (
        <rect
          data-part="gate"
          className="fig-gate"
          x={x - 3}
          y={y - height / 2}
          width={6}
          height={height}
          rx={3}
          {...rest}
        />
      );
    case 'band':
      return (
        <rect
          data-part="gate"
          className="fig-gate-open"
          x={x - 13}
          y={y - 8}
          width={26}
          height={16}
          rx={4}
          {...rest}
        />
      );
    case 'capsule':
      return (
        <rect
          data-part="gate"
          className="fig-gate-open"
          x={x - 6}
          y={y - height / 2}
          width={12}
          height={height}
          rx={6}
          {...rest}
        />
      );
  }
}
