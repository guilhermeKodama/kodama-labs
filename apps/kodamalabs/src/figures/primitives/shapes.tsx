import type { SVGAttributes } from 'react';

type Rest = Omit<SVGAttributes<SVGElement>, 'className' | 'x' | 'y' | 'width' | 'height' | 'rx' | 'd' | 'cx' | 'cy' | 'r' | 'points' | 'kind'>;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
  rx?: number;
}

/**
 * panel         a drawn screen, card or node
 * quiet         context only: a step, a document
 * ink           the subject: committed, or the node being followed
 * panel-dashed  a step that is still a proposal
 * dashed        a proposed thing with no surface
 * soft-dashed   the same, in shadow: what a model would do
 * outline       a pill or a chip
 */
export type PanelKind = 'panel' | 'quiet' | 'ink' | 'panel-dashed' | 'dashed' | 'soft-dashed' | 'outline';

const PANEL: Record<PanelKind, string> = {
  panel: 'fig-panel',
  quiet: 'fig-panel-quiet',
  ink: 'fig-panel-ink',
  'panel-dashed': 'fig-panel-dashed',
  dashed: 'fig-box-dashed',
  'soft-dashed': 'fig-box-soft',
  outline: 'fig-outline',
};

type PanelProps = { kind?: PanelKind } & (Box | { d: string }) & Rest;

/** An outlined surface: a rectangle, or any closed path. */
export function Panel(props: PanelProps) {
  if ('d' in props) {
    const { kind = 'panel', d, ...rest } = props;
    return <path className={PANEL[kind]} d={d} {...rest} />;
  }
  const { kind = 'panel', x, y, width, height, rx, ...rest } = props;
  return <rect className={PANEL[kind]} x={x} y={y} width={width} height={height} rx={rx} {...rest} />;
}

/** ink, muted, soft: solid. wash: the faint ink of a ribbon or a chip. */
export type FillTone = 'ink' | 'muted' | 'soft' | 'wash';

const FILL: Record<FillTone, string> = {
  ink: 'fig-fill-ink',
  muted: 'fig-fill-muted',
  soft: 'fig-fill-soft',
  wash: 'fig-wash',
};

type FillProps = { tone: FillTone } & (Box | { d: string } | { cx: number; cy: number; r: number }) & Rest;

/** A filled shape with no outline: a button, a marker, a node, a ribbon. */
export function Fill(props: FillProps) {
  if ('d' in props) {
    const { tone, d, ...rest } = props;
    return <path className={FILL[tone]} d={d} {...rest} />;
  }
  if ('cx' in props) {
    const { tone, cx, cy, r, ...rest } = props;
    return <circle className={FILL[tone]} cx={cx} cy={cy} r={r} {...rest} />;
  }
  const { tone, x, y, width, height, rx, ...rest } = props;
  return <rect className={FILL[tone]} x={x} y={y} width={width} height={height} rx={rx} {...rest} />;
}

/** An arrowhead or a tick of a construction line: an open polyline. */
export function Chevron({ points, ...rest }: { points: string } & Rest) {
  return <polyline className="fig-quiet" points={points} {...rest} />;
}
