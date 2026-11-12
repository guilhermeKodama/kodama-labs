import type { SVGAttributes } from 'react';

/**
 * wait    a hollow ring: the gate has been asked and has not answered
 * ripple  the echo of a press
 * check   a ring that completes one part at a time
 */
export type EchoShape = 'wait' | 'ripple' | 'check';

interface EchoProps extends Omit<SVGAttributes<SVGElement>, 'x' | 'y' | 'className'> {
  shape: EchoShape;
  /** Centre of the gate it belongs to. */
  x: number;
  y: number;
}

const RADIUS = 6;

/**
 * A mark a gate makes only while it decides. It is invisible in the finished
 * drawing (`m-transient`) and exists for the animation layer alone.
 */
export function Echo({ shape, x, y, ...rest }: EchoProps) {
  switch (shape) {
    case 'wait':
      return <circle data-part="echo" className="fig-gate-open m-transient" cx={x} cy={y} r={RADIUS} {...rest} />;
    case 'ripple':
      return <circle data-part="echo" className="fig-echo m-transient" cx={x} cy={y} r={RADIUS + 0.5} {...rest} />;
    case 'check':
      // A ring drawn clockwise from twelve o'clock, with its length normalised to 1.
      return (
        <path
          data-part="echo"
          className="fig-gate-open m-transient"
          pathLength={1}
          d={`M${x} ${y - RADIUS}a${RADIUS} ${RADIUS} 0 1 1 0 ${2 * RADIUS}a${RADIUS} ${RADIUS} 0 1 1 0 ${-2 * RADIUS}`}
          {...rest}
        />
      );
  }
}
