import type { SVGAttributes } from 'react';

/**
 * proposed   dashed ink: something a machine proposed
 * candidate  dashed and quiet: a proposal that will not pass
 * committed  solid ink
 * trunk      the heavier line committed strands merge into
 * quiet      a construction line (connector, loop, bracket)
 */
export type StrandKind = 'proposed' | 'candidate' | 'committed' | 'trunk' | 'quiet';

const CLASS: Record<StrandKind, string> = {
  proposed: 'fig-proposed',
  candidate: 'fig-candidate',
  committed: 'fig-committed',
  trunk: 'fig-trunk',
  quiet: 'fig-quiet',
};

type Geometry =
  | { d: string }
  | { from: readonly [number, number]; to: readonly [number, number] };

type StrandProps = { kind: StrandKind } & Geometry &
  Omit<SVGAttributes<SVGElement>, 'd' | 'from' | 'to' | 'className'>;

/** One stroke of the notation: a straight segment or a path. */
export function Strand(props: StrandProps) {
  if ('d' in props) {
    const { kind, d, ...rest } = props;
    return <path className={CLASS[kind]} d={d} {...rest} />;
  }
  const { kind, from, to, ...rest } = props;
  return <line className={CLASS[kind]} x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} {...rest} />;
}
