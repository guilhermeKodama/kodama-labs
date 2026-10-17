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
  /** The spine is horizontal (a narrow figure): bar and capsule lie along it. */
  across?: boolean;
}

/** The only accent in a figure: where a person or a fail-closed check decides. */
export function Gate({ shape, x, y, height = 26, across = false, ...rest }: GateProps) {
  /** A box of `thickness` across the spine and `height` along it, centred on the gate. */
  const along = (thickness: number) =>
    across
      ? { x: x - height / 2, y: y - thickness / 2, width: height, height: thickness, rx: thickness / 2 }
      : { x: x - thickness / 2, y: y - height / 2, width: thickness, height, rx: thickness / 2 };

  switch (shape) {
    case 'dot':
      return <circle data-part="gate" className="fig-gate" cx={x} cy={y} r={6.5} {...rest} />;
    case 'ring':
      return <circle data-part="gate" className="fig-gate-open" cx={x} cy={y} r={6} {...rest} />;
    case 'bar':
      return (
        <rect data-part="gate" className="fig-gate" {...along(6)} {...rest} />
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
        <rect data-part="gate" className="fig-gate-open" {...along(12)} {...rest} />
      );
  }
}
