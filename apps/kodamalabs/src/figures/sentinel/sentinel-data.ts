/**
 * The Sentinel figure: public records flow through processing steps into
 * analysis engines; the price engine proposes candidates, an evaluator that
 * defaults to "suppress" stands on the spine, and one candidate becomes an
 * alert. An invented example: no real tender, company or person.
 */

const NODE = { width: 170, height: 24, rx: 6, pitch: 32 } as const;

/** The three columns of the pipeline: where each starts and what it holds. */
export const PIPELINE = [
  {
    key: 'sources',
    x: 0.5,
    top: 36.5,
    nodes: ['tenders', 'contracts', 'items', 'documents', 'companies', 'sanctions', 'elections'],
  },
  { key: 'steps', x: 214.5, top: 68.5, nodes: ['normalise', 'link', 'shareholders', 'sanctions', 'donations'] },
  { key: 'engines', x: 428.5, top: 52.5, nodes: ['indicators', 'sanctioned', 'prices', 'shared', 'political', 'review'] },
] as const;

export type Column = (typeof PIPELINE)[number];

/** The one run the figure follows: tenders, normalised, into the price engine. */
export const JOB = [
  ['tenders', 'normalise'],
  ['normalise', 'prices'],
] as const;

/** The engine whose output reaches the gate. */
export const PRICE_ENGINE = 'prices';

/** What feeds what, per gap between two columns. The job's own edges are in JOB. */
const FEEDS = [
  [
    ['contracts', 'normalise'],
    ['items', 'normalise'],
    ['documents', 'normalise'],
    ['companies', 'link'],
    ['companies', 'shareholders'],
    ['sanctions', 'sanctions'],
    ['elections', 'donations'],
  ],
  [
    ['normalise', 'review'],
    ['link', 'indicators'],
    ['link', 'political'],
    ['shareholders', 'shared'],
    ['sanctions', 'sanctioned'],
    ['donations', 'political'],
  ],
] as const;

export function nodeBox(column: Column, index: number) {
  return { x: column.x, y: column.top + index * NODE.pitch, width: NODE.width, height: NODE.height, rx: NODE.rx };
}

/** Left edge of the label of a node, and its baseline. */
export function nodeLabel(column: Column, index: number) {
  return { x: column.x + 9.5, y: column.top + index * NODE.pitch + 16 };
}

/**
 * A connector across the gap after column `gap`, from one node to another.
 * Connectors are drawn in a group shifted half a unit down, so they leave
 * from whole numbers and still meet the middle of each node.
 */
function connector(gap: 0 | 1, from: string, to: string): string {
  const source = PIPELINE[gap];
  const target = PIPELINE[gap + 1]!;
  const y0 = source.top - 0.5 + 12 + (source.nodes as readonly string[]).indexOf(from) * NODE.pitch;
  const y1 = target.top - 0.5 + 12 + (target.nodes as readonly string[]).indexOf(to) * NODE.pitch;
  const x0 = source.x - 0.5 + NODE.width;
  const x1 = target.x - 0.5;
  const mid = (x0 + x1) / 2;
  return `M ${x0} ${y0} C ${mid} ${y0} ${mid} ${y1} ${x1} ${y1}`;
}

/** A node's name on the page: its column and its key, since two columns share a key. */
export function nodeId(column: Column, node: string): string {
  return `${column.key}.${node}`;
}

interface Edge {
  from: string;
  to: string;
}

function edge(gap: 0 | 1, from: string, to: string): Edge {
  return { from: nodeId(PIPELINE[gap], from), to: nodeId(PIPELINE[gap + 1]!, to) };
}

const EDGES: readonly Edge[] = ([0, 1] as const).flatMap((gap) => [
  ...FEEDS[gap].map(([from, to]) => edge(gap, from, to)),
  edge(gap, JOB[gap][0], JOB[gap][1]),
]);

/** Every node reachable from `start` along the edges, in one direction. */
function reach(start: string, direction: 'up' | 'down'): Set<string> {
  const found = new Set([start]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const { from, to } of EDGES) {
      const [near, far] = direction === 'down' ? [from, to] : [to, from];
      if (found.has(near) && !found.has(far)) grew = Boolean(found.add(far));
    }
  }
  return found;
}

const NODE_IDS = PIPELINE.flatMap((column) => column.nodes.map((node) => nodeId(column, node)));

/**
 * The nodes whose lineage an edge is part of: everything it feeds, and
 * everything that feeds it. Pointing at any of them traces this edge.
 */
function lineage({ from, to }: Edge): string {
  return NODE_IDS.filter((node) => reach(node, 'up').has(to) || reach(node, 'down').has(from)).join(' ');
}

export interface Connector {
  d: string;
  lineage: string;
}

export function feeds(gap: 0 | 1): Connector[] {
  return FEEDS[gap].map(([from, to]) => ({ d: connector(gap, from, to), lineage: lineage(edge(gap, from, to)) }));
}

export function job(gap: 0 | 1): Connector {
  const [from, to] = JOB[gap];
  return { d: connector(gap, from, to), lineage: lineage(edge(gap, from, to)) };
}

/**
 * One rule per node: while the reader points at it, the edges of its lineage
 * are drawn in ink. Written out because a selector cannot compare two
 * attributes; scoped to pointers that can hover.
 */
export function lineageRules(): string {
  const rules = NODE_IDS.map(
    (node) => `[data-fig="sentinel"]:has([data-node="${node}"]:hover) [data-lineage~="${node}"]{stroke:var(--kl-ink)}`,
  );
  return `@media (hover:hover){${rules.join('')}}`;
}

/** A marker on the middle of each leg of the job. */
export const JOB_MARKS = [
  { cx: 192, cy: 64.5 },
  { cx: 406, cy: 104.5 },
] as const;

/** The strand's height: the middle of the price engine. */
export const STRAND = 128;

/** Where each candidate meets the evaluator, top to bottom. The middle one passes. */
export const CANDIDATES = [104, 116, 128, 140, 152] as const;

export function candidatePath(y: number): string {
  return y === STRAND ? `M 599 ${STRAND} L 696 ${y}` : `M 599 ${STRAND} C 640 ${STRAND} 652 ${y} 696 ${y}`;
}

export const ALERT = {
  card: { x: 760.5, y: 92.5, width: 439, height: 110, rx: 10 },
  severity: { x: 776.5, y: 106.5, width: 58, height: 20, rx: 10 },
  kind: { x: 842, y: 106, width: 100, height: 21, rx: 4 },
  left: 776,
  notes: [226, 244, 262],
} as const;
