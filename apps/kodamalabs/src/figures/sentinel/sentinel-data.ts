/**
 * The Sentinel figure: public records flow through processing steps into
 * analysis engines; the price engine proposes candidates, an evaluator that
 * defaults to "suppress" stands on the spine, and one candidate becomes an
 * alert. An invented example: no real tender, company or person.
 */

/** The three columns of the pipeline and what each holds. */
export const PIPELINE = [
  { key: 'sources', nodes: ['tenders', 'contracts', 'items', 'documents', 'companies', 'sanctions', 'elections'] },
  { key: 'steps', nodes: ['normalise', 'link', 'shareholders', 'sanctions', 'donations'] },
  { key: 'engines', nodes: ['indicators', 'sanctioned', 'prices', 'shared', 'political', 'review'] },
] as const;

export type Column = (typeof PIPELINE)[number];

/** How a pipeline is laid out on a sheet: the size of a node and where each column starts. */
export interface PipelineLayout {
  node: { width: number; height: number; rx: number; pitch: number };
  columns: Record<Column['key'], { x: number; top: number }>;
}

/** The wide sheet: three columns left of the spine. */
export const WIDE_LAYOUT: PipelineLayout = {
  node: { width: 170, height: 24, rx: 6, pitch: 32 },
  columns: {
    sources: { x: 0.5, top: 36.5 },
    steps: { x: 214.5, top: 68.5 },
    engines: { x: 428.5, top: 52.5 },
  },
};

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

export function nodeBox(column: Column, index: number, layout: PipelineLayout = WIDE_LAYOUT) {
  const { x, top } = layout.columns[column.key];
  const { width, height, rx, pitch } = layout.node;
  return { x, y: top + index * pitch, width, height, rx };
}

/** Left edge of the label of a node, and its baseline. */
export function nodeLabel(column: Column, index: number) {
  const box = nodeBox(column, index);
  return { x: box.x + 9.5, y: box.y + 16 };
}

/** The two ends of an edge across the gap after column `gap`: the middle of each node's facing side. */
function ends(gap: 0 | 1, from: string, to: string, layout: PipelineLayout) {
  const source = PIPELINE[gap];
  const target = PIPELINE[gap + 1]!;
  const { width, height, pitch } = layout.node;
  const middle = (column: Column, node: string) =>
    layout.columns[column.key].top - 0.5 + height / 2 + (column.nodes as readonly string[]).indexOf(node) * pitch;
  return {
    x0: layout.columns[source.key].x - 0.5 + width,
    y0: middle(source, from),
    x1: layout.columns[target.key].x - 0.5,
    y1: middle(target, to),
  };
}

/**
 * A connector across the gap after column `gap`, from one node to another.
 * Connectors are drawn in a group shifted half a unit down, so they leave
 * from whole numbers and still meet the middle of each node.
 */
function connector(gap: 0 | 1, from: string, to: string, layout: PipelineLayout): string {
  const { x0, y0, x1, y1 } = ends(gap, from, to, layout);
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

export function feeds(gap: 0 | 1, layout: PipelineLayout = WIDE_LAYOUT): Connector[] {
  return FEEDS[gap].map(([from, to]) => ({
    d: connector(gap, from, to, layout),
    lineage: lineage(edge(gap, from, to)),
  }));
}

export function job(gap: 0 | 1, layout: PipelineLayout = WIDE_LAYOUT): Connector {
  const [from, to] = JOB[gap];
  return { d: connector(gap, from, to, layout), lineage: lineage(edge(gap, from, to)) };
}

/** A marker on the middle of each leg of the job (in the sheet's own coordinates). */
export function jobMark(gap: 0 | 1, layout: PipelineLayout = WIDE_LAYOUT) {
  const { x0, y0, x1, y1 } = ends(gap, JOB[gap][0], JOB[gap][1], layout);
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 + 0.5 };
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
