import type { SVGAttributes } from 'react';

interface LabelProps extends Omit<SVGAttributes<SVGTextElement>, 'className' | 'x' | 'y'> {
  x: number;
  /** Baseline. */
  y: number;
  /** mono: the system reporting (default). name: a project name, display face. */
  face?: 'mono' | 'name';
  size?: 'base' | 'small';
  tone?: 'ink' | 'muted';
  anchor?: 'start' | 'middle' | 'end';
  /** Always a message or a formatted value, never a literal. */
  children: string;
}

/** A line of text inside a figure. SVG text does not wrap. */
export function Label({
  x,
  y,
  face = 'mono',
  size = 'base',
  tone = 'ink',
  anchor = 'start',
  children,
  ...rest
}: LabelProps) {
  const classes = ['fig-text'];
  if (face === 'name') classes.push('fig-text-name');
  if (size === 'small') classes.push('fig-text-small');
  if (tone === 'muted') classes.push('fig-text-muted');
  if (anchor === 'end') classes.push('fig-text-end');
  if (anchor === 'middle') classes.push('fig-text-middle');

  return (
    <text className={classes.join(' ')} x={x} y={y} {...rest}>
      {children}
    </text>
  );
}
