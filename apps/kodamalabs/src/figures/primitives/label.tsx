import type { SVGAttributes } from 'react';

import { wrapLabel } from '../geometry/wrap';

interface LabelProps extends Omit<SVGAttributes<SVGTextElement>, 'className' | 'x' | 'y'> {
  x: number;
  /** Baseline. */
  y: number;
  /**
   * mono: the system reporting (default). name: a project name, display face.
   * ui, ui-small, ui-large: text of a drawn interface.
   */
  face?: 'mono' | 'name' | 'ui' | 'ui-small' | 'ui-large';
  size?: 'base' | 'small';
  tone?: 'ink' | 'muted' | 'inverse';
  bold?: boolean;
  anchor?: 'start' | 'middle' | 'end';
  /** Always a message or a formatted value, never a literal. */
  children: string;
}

const FACE = {
  mono: null,
  name: 'fig-text-name',
  ui: 'fig-text-ui',
  'ui-small': 'fig-text-ui-small',
  'ui-large': 'fig-text-ui-large',
} as const;

/** A line of text inside a figure. SVG text does not wrap. */
export function Label({
  x,
  y,
  face = 'mono',
  size = 'base',
  tone = 'ink',
  bold = false,
  anchor = 'start',
  children,
  ...rest
}: LabelProps) {
  const classes = ['fig-text'];
  if (FACE[face]) classes.push(FACE[face]);
  if (size === 'small') classes.push('fig-text-small');
  if (bold) classes.push('fig-text-bold');
  if (tone === 'muted') classes.push('fig-text-muted');
  if (tone === 'inverse') classes.push('fig-text-inverse');
  if (anchor === 'end') classes.push('fig-text-end');
  if (anchor === 'middle') classes.push('fig-text-middle');

  return (
    <text className={classes.join(' ')} x={x} y={y} {...rest}>
      {children}
    </text>
  );
}

interface LinesProps extends Pick<LabelProps, 'x' | 'y' | 'face' | 'size' | 'tone' | 'bold' | 'anchor' | 'children'> {
  /** Longest line, in characters. */
  max: number;
  /** Distance between baselines. */
  pitch?: number;
}

/** A label that may need more than one line: wrapped at `max` characters, top line at `y`. */
export function Lines({ max, pitch = 15, y, children, ...label }: LinesProps) {
  return (
    <>
      {wrapLabel(children, max).map((line, index) => (
        <Label key={line} y={y + index * pitch} {...label}>
          {line}
        </Label>
      ))}
    </>
  );
}
