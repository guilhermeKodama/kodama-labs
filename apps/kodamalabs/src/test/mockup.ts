import fs from 'node:fs';
import path from 'node:path';

/**
 * The approved mockup (design/main.dc.html) is the porting spec. This reads
 * its figures and reduces any figure, the mockup's or ours, to a list of
 * signatures (shape, geometry, notation, text), so a test can say that a
 * figure was ported literally.
 */
const MOCKUP = fs.readFileSync(path.resolve(__dirname, '../../design/main.dc.html'), 'utf8');

/** The figures of the mockup, in page order. */
export const MOCKUP_FIGURES = ['lanes', 'capital', 'sentinel', 'cosmos', 'triage', 'playbook', 'agents', 'deploy'] as const;
export type MockupFigure = (typeof MOCKUP_FIGURES)[number];

/** The mockup's short class names, as the notation classes of src/styles/figure.css. */
const NOTATION: Record<string, string> = {
  sp: 'fig-spine',
  d: 'fig-proposed',
  dq: 'fig-candidate',
  c: 'fig-committed',
  c2: 'fig-trunk',
  q: 'fig-quiet',
  h: 'fig-hairline',
  hd: 'fig-hairline-dashed',
  g: 'fig-gate',
  go: 'fig-gate-open',
  p: 'fig-panel',
  pq: 'fig-panel-quiet',
  pi: 'fig-panel-ink',
  pdd: 'fig-panel-dashed',
  pd: 'fig-box-dashed',
  ps: 'fig-box-soft',
  o: 'fig-outline',
  ink: 'fig-fill-ink',
  dot: 'fig-fill-ink',
  n2: 'fig-fill-ink',
  n1: 'fig-fill-muted',
  n3: 'fig-fill-soft',
  w: 'fig-wash',
  pad: 'fig-pad',
  m: 'fig-text-muted',
  s: 'fig-text-small',
  u: 'fig-text-ui',
  u2: 'fig-text-ui-small',
  u3: 'fig-text-ui-large',
  b: 'fig-text-bold',
  e: 'fig-text-end',
  mid: 'fig-text-middle',
  nm: 'fig-text-name',
  inv: 'fig-text-inverse',
};

const GEOMETRY = ['x', 'y', 'x1', 'y1', 'x2', 'y2', 'cx', 'cy', 'r', 'rx', 'width', 'height', 'd', 'points'];

function number(value: string): string {
  return String(Math.round(Number(value) * 100) / 100);
}

/** A path or point list as its commands and rounded numbers, whatever the spacing. */
function shape(value: string): string {
  return (value.match(/[a-zA-Z]|-?\d*\.?\d+/g) ?? [])
    .map((token) => (/[a-zA-Z]/.test(token) ? token : number(token)))
    .join(' ');
}

function decode(text: string): string {
  return text
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

/**
 * One line per drawn element: tag, notation classes, geometry, text. Groups,
 * links, invisible pads and the transient marks of the motion layer are not
 * part of the drawing.
 */
export function signatures(svg: string, fromMockup = false): string[] {
  const lines: string[] = [];

  for (const match of svg.matchAll(/<(line|rect|circle|path|polyline|text)\b([^>]*?)\/?>(?:([^<]*)<\/text>)?/g)) {
    const [, tag, raw, text] = match;
    const attrs = Object.fromEntries(
      [...raw!.matchAll(/([a-zA-Z0-9:-]+)="([^"]*)"/g)].map((attr) => [attr[1]!, attr[2]!]),
    );
    let classes = (attrs.class ?? '').split(/\s+/).filter(Boolean);
    if (fromMockup) {
      classes = classes.map((name) => NOTATION[name] ?? '').filter(Boolean);
      if (tag === 'text') classes.push('fig-text');
    } else {
      if (classes.includes('m-transient')) continue;
      classes = classes.filter((name) => name.startsWith('fig-'));
    }
    if (classes.includes('fig-pad')) continue;

    const geometry = GEOMETRY.filter((name) => attrs[name] !== undefined).map(
      (name) => `${name}=${name === 'd' || name === 'points' ? shape(attrs[name]!) : number(attrs[name]!)}`,
    );
    lines.push([tag, classes.sort().join('.'), ...geometry, tag === 'text' ? decode(text ?? '').trim() : ''].join(' | '));
  }

  return lines.sort();
}

/** The markup of one figure of the mockup. */
export function mockupSvg(figure: MockupFigure): string {
  const figures = [...MOCKUP.matchAll(/<svg viewBox="0 0 (?:1200|792) [^"]*"[\s\S]*?<\/svg>/g)].map((match) => match[0]);
  return figures[MOCKUP_FIGURES.indexOf(figure)]!;
}

/** The signatures of one figure of the mockup. */
export function mockupSignatures(figure: MockupFigure): string[] {
  return signatures(mockupSvg(figure), true);
}
