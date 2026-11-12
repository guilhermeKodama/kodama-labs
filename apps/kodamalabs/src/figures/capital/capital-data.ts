/**
 * The Capital figure: an import plan proposed by the assistant on the left of
 * the spine, my click on it, and on the right what the plan becomes: ledger
 * rows, and the same ledger read as a cash flow.
 *
 * Every row and amount is invented.
 */

/** Rows of the proposed plan, by their key under `figures.capital.rows`. */
export const PLAN_ROWS = ['grocery', 'invoice', 'electricity', 'card', 'pharmacy'] as const;

export const PLAN = {
  panel: { x: 0.5, y: 8.5, width: 600, height: 322, rx: 8 },
  headBaseline: 34,
  headRule: 48.5,
  firstRow: 72,
  rowPitch: 37,
  /** Dashed rule under a row, below its baseline. */
  ruleBelow: 13.5,
  footRule: 270.5,
  columns: { date: 16, what: 84, account: 300, category: 420, amount: 584 },
  waitingBaseline: 305,
  button: { x: 468, y: 286, width: 116, height: 28, rx: 6 },
  /** The strand's height: the plan leaves from its button. */
  strand: 300,
} as const;

export const LEDGER = {
  proposalEnd: 695,
  committedStart: 710,
  committedEnd: 934,
  label: { x: 946, y: 304 },
  /** The undo loop: from the ledger back under the gate into the plan. */
  undo: 'M 900 300 C 900 314 888 320 868 320 L 607 320',
  undoHead: '613,315 607,320 613,325',
  notes: 340,
} as const;

export const VIEWS = [
  { key: 'table', x: 726 },
  { key: 'pivot', x: 774 },
  { key: 'chart', x: 820 },
  { key: 'board', x: 868 },
  { key: 'calendar', x: 918 },
] as const;

/** The view the drawing shows; its tab is underlined from `x` to `end`. */
export const ACTIVE_VIEW = { key: 'chart', end: 853 } as const;

/**
 * The cash flow, as a Sankey diagram in four columns: income, companies, the
 * person, and where the money went. Values are in thousands; a thousand is
 * 5.2 units tall. `label` is where the node's name sits.
 */
const UNIT = 5.2;
const NODE_WIDTH = 10;
export const COLUMNS = [726, 842, 958, 1074] as const;

interface FlowNode {
  key: string;
  column: 0 | 1 | 2 | 3;
  y: number;
  value: number;
  tone: 'muted' | 'ink' | 'soft';
  label: { x: number; y: number; anchor?: 'middle' };
}

export const FLOW_NODES: readonly FlowNode[] = [
  { key: 'consulting', column: 0, y: 52, value: 24, tone: 'muted', label: { x: 789, y: 118, anchor: 'middle' } },
  { key: 'products', column: 0, y: 186.8, value: 9, tone: 'muted', label: { x: 742, y: 214 } },
  { key: 'dividends', column: 0, y: 247.6, value: 2, tone: 'muted', label: { x: 742, y: 256.5 } },
  { key: 'companyA', column: 1, y: 52, value: 24, tone: 'ink', label: { x: 858, y: 118 } },
  { key: 'companyB', column: 1, y: 186.8, value: 9, tone: 'ink', label: { x: 858, y: 214 } },
  { key: 'personal', column: 2, y: 92, value: 28, tone: 'ink', label: { x: 974, y: 168 } },
  { key: 'costs', column: 3, y: 44, value: 3, tone: 'soft', label: { x: 1090, y: 56 } },
  { key: 'taxes', column: 3, y: 65.6, value: 4, tone: 'soft', label: { x: 1090, y: 80 } },
  { key: 'housing', column: 3, y: 92.4, value: 6.5, tone: 'soft', label: { x: 1090, y: 113 } },
  { key: 'food', column: 3, y: 132.2, value: 3.5, tone: 'soft', label: { x: 1090, y: 145 } },
  { key: 'transport', column: 3, y: 156.4, value: 2, tone: 'soft', label: { x: 1090, y: 165.5 } },
  { key: 'other', column: 3, y: 172.8, value: 4, tone: 'soft', label: { x: 1090, y: 187 } },
  { key: 'investments', column: 3, y: 199.6, value: 8, tone: 'soft', label: { x: 1090, y: 224 } },
  // What is left over is income again, so it is drawn like income.
  { key: 'surplus', column: 3, y: 247.2, value: 4, tone: 'muted', label: { x: 1090, y: 261.5 } },
];

/**
 * Money moving from one node to another, in the order it stacks on both.
 * `past` is a column the ribbon has to run flat beside before it may bend.
 */
const FLOW_LINKS: ReadonlyArray<readonly [from: string, to: string, value: number, past?: number]> = [
  ['consulting', 'companyA', 24],
  ['products', 'companyB', 9],
  ['companyA', 'costs', 3],
  ['companyA', 'taxes', 4],
  ['companyA', 'personal', 17],
  ['companyB', 'personal', 9],
  ['dividends', 'personal', 2, 1],
  ['personal', 'housing', 6.5],
  ['personal', 'food', 3.5],
  ['personal', 'transport', 2],
  ['personal', 'other', 4],
  ['personal', 'investments', 8],
  ['personal', 'surplus', 4],
];

const round = (value: number) => Math.round(value * 10) / 10;

/** A node's bar. `columns` is where each column starts: the wide sheet's, or a narrower one. */
export function nodeBox(node: FlowNode, columns: readonly number[] = COLUMNS) {
  return { x: columns[node.column]!, y: node.y, width: NODE_WIDTH, height: round(node.value * UNIT), rx: 2 };
}

export interface Ribbon {
  /** Column the ribbon leaves from. */
  column: number;
  d: string;
}

/**
 * The ribbons of the flow. Each takes the next free slice of its source and
 * of its target, top down, and bends across the whole gap between them.
 */
export function flowRibbons(columns: readonly number[] = COLUMNS): Ribbon[] {
  const used = new Map<string, { out: number; in: number }>();
  const slot = (key: string) => used.get(key) ?? used.set(key, { out: 0, in: 0 }).get(key)!;
  const node = (key: string) => FLOW_NODES.find((candidate) => candidate.key === key)!;

  return FLOW_LINKS.map(([fromKey, toKey, value, past]) => {
    const from = node(fromKey);
    const to = node(toKey);
    const height = value * UNIT;
    const top0 = round(from.y + slot(fromKey).out);
    const top1 = round(to.y + slot(toKey).in);
    const bottom0 = round(top0 + height);
    const bottom1 = round(top1 + height);
    slot(fromKey).out += height;
    slot(toKey).in += height;

    const start = columns[from.column]! + NODE_WIDTH;
    const end = columns[to.column]!;
    const bend = past === undefined ? start : columns[past]! + NODE_WIDTH;
    const mid = (bend + end) / 2;

    if (top0 === top1) {
      return { column: from.column, d: `M ${start} ${top0} L ${end} ${top0} L ${end} ${bottom0} L ${start} ${bottom0} Z` };
    }
    const lead = bend === start ? '' : ` L ${bend} ${top0}`;
    const tail = bend === start ? '' : ` L ${start} ${bottom0}`;
    return {
      column: from.column,
      d: `M ${start} ${top0}${lead} C ${mid} ${top0} ${mid} ${top1} ${end} ${top1} L ${end} ${bottom1} C ${mid} ${bottom1} ${mid} ${bottom0} ${bend} ${bottom0}${tail} Z`,
    };
  });
}
