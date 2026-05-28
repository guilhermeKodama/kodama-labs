import type {
  Transaction,
  Transfer,
  Business,
  PersonalAccount,
} from '@/types';

export type SankeyLayer = 'income' | 'business' | 'personal' | 'output';

export type SankeyNodeKind =
  | 'category'
  | 'business'
  | 'personal'
  | 'expense'
  | 'investment'
  | 'surplus'
  | 'others'
  | 'reserves';

export interface SankeyDataNode {
  id: string;
  name: string;
  layer: SankeyLayer;
  kind: SankeyNodeKind;
  color: string;
  /** Populated only on the "Others" expense aggregate node. */
  subItems?: Array<{ name: string; value: number }>;
}

export interface SankeyDataLink {
  source: number;
  target: number;
  value: number;
}

export interface CashflowSankeyResult {
  nodes: SankeyDataNode[];
  links: SankeyDataLink[];
  totals: {
    income: number;
    expenses: number;
    investments: number;
    surplus: number;
    deficit: number;
  };
}

export interface BuildCashflowSankeyOptions {
  dateFrom?: Date;
  dateTo?: Date;
  /** Threshold below which expense categories are grouped into "Others". Default 0.02 (2%). */
  groupThreshold?: number;
  /** Optional filter — only consider transactions/transfers touching these entity ids. */
  filteredEntityIds?: Set<string>;
  /** i18n labels (caller passes translated strings). */
  labels?: {
    personal?: string;
    others?: string;
    investments?: string;
    surplus?: string;
    uncategorized?: string;
    reserves?: string;
  };
}

const COLORS = {
  income: '#10b981',
  business: '#06b6d4',
  personal: '#8b5cf6',
  expense: '#ef4444',
  investment: '#a855f7',
  surplus: '#22d3ee',
  others: '#94a3b8',
  reserves: '#fbbf24',
};

const DEFAULT_LABELS = {
  personal: 'Personal',
  others: 'Others',
  investments: 'Investments',
  surplus: 'Surplus',
  uncategorized: 'Uncategorized',
  reserves: 'From Reserves',
};

export function buildCashflowSankey(
  transactions: Transaction[],
  transfers: Transfer[],
  businesses: Business[],
  personalAccount: PersonalAccount | null,
  options: BuildCashflowSankeyOptions = {}
): CashflowSankeyResult {
  const {
    dateFrom,
    dateTo,
    groupThreshold = 0.02,
    filteredEntityIds,
    labels: labelOverrides,
  } = options;

  const labels = { ...DEFAULT_LABELS, ...labelOverrides };

  const fromMs = dateFrom?.getTime();
  const toMs = dateTo?.getTime();
  const inRange = (date: Date): boolean => {
    const ts = new Date(date).getTime();
    if (fromMs !== undefined && ts < fromMs) return false;
    if (toMs !== undefined && ts > toMs) return false;
    return true;
  };

  const entityFilterActive = filteredEntityIds !== undefined && filteredEntityIds.size > 0;
  const matchesEntity = (id: string) =>
    !entityFilterActive || filteredEntityIds!.has(id);

  const businessById = new Map(businesses.map((b) => [b.id, b]));
  const isPersonal = (entityId: string) =>
    personalAccount !== null && personalAccount.id === entityId;
  const isKnownEntity = (entityId: string) =>
    isPersonal(entityId) || businessById.has(entityId);

  // ---- accumulators ----
  // entityId → category → amount
  const incomeByEntityCategory = new Map<string, Map<string, number>>();
  const expenseByEntityCategory = new Map<string, Map<string, number>>();
  // entityId → amount (aggregated investments routed via the entity)
  const investmentByEntity = new Map<string, number>();
  // `${fromId}::${toId}` → amount (business → personal profit distribution)
  const profitDistByPair = new Map<string, number>();

  const addToMapMap = (
    outer: Map<string, Map<string, number>>,
    outerKey: string,
    innerKey: string,
    value: number
  ) => {
    let inner = outer.get(outerKey);
    if (!inner) {
      inner = new Map();
      outer.set(outerKey, inner);
    }
    inner.set(innerKey, (inner.get(innerKey) ?? 0) + value);
  };

  // ---- ingest transactions ----
  for (const tx of transactions) {
    if (!inRange(tx.date)) continue;
    if (!matchesEntity(tx.entityId)) continue;
    if (!isKnownEntity(tx.entityId)) continue;

    const amount = tx.amount * tx.exchangeRate;
    if (amount <= 0) continue;

    const category = (tx.category || labels.uncategorized).trim() || labels.uncategorized;

    if (tx.type === 'income') {
      addToMapMap(incomeByEntityCategory, tx.entityId, category, amount);
    } else if (tx.type === 'expense') {
      // Convention from calculations.ts: expenses with category "Investment" are
      // really investment contributions (aporte via fund account).
      if (category === 'Investment') {
        investmentByEntity.set(
          tx.entityId,
          (investmentByEntity.get(tx.entityId) ?? 0) + amount
        );
      } else {
        addToMapMap(expenseByEntityCategory, tx.entityId, category, amount);
      }
    } else if (tx.type === 'investment') {
      investmentByEntity.set(
        tx.entityId,
        (investmentByEntity.get(tx.entityId) ?? 0) + amount
      );
    }
  }

  // ---- ingest transfers ----
  // v1 handles: profit_distribution (business → personal) and investment_deposit.
  // Reimbursement, capital_injection, investment_withdrawal are intentionally
  // skipped to keep the diagram readable; they are typically small relative to
  // the main flow and can be added in a follow-up iteration.
  for (const tr of transfers) {
    if (!inRange(tr.date)) continue;
    const amount = tr.amount * tr.exchangeRate;
    if (amount <= 0) continue;

    if (tr.direction === 'profit_distribution') {
      if (!matchesEntity(tr.fromEntityId) && !matchesEntity(tr.toEntityId)) continue;
      if (!businessById.has(tr.fromEntityId) || !isPersonal(tr.toEntityId)) continue;
      const key = `${tr.fromEntityId}::${tr.toEntityId}`;
      profitDistByPair.set(key, (profitDistByPair.get(key) ?? 0) + amount);
    } else if (tr.direction === 'investment_deposit') {
      if (!matchesEntity(tr.fromEntityId)) continue;
      if (!isKnownEntity(tr.fromEntityId)) continue;
      investmentByEntity.set(
        tr.fromEntityId,
        (investmentByEntity.get(tr.fromEntityId) ?? 0) + amount
      );
    }
  }

  // ---- build nodes + links ----
  const nodes: SankeyDataNode[] = [];
  const nodeIndex = new Map<string, number>();

  const upsertNode = (node: SankeyDataNode): number => {
    const existing = nodeIndex.get(node.id);
    if (existing !== undefined) return existing;
    const idx = nodes.length;
    nodes.push(node);
    nodeIndex.set(node.id, idx);
    return idx;
  };

  const entityNodeFor = (entityId: string): number | null => {
    if (isPersonal(entityId)) {
      return upsertNode({
        id: 'personal',
        name: labels.personal,
        layer: 'personal',
        kind: 'personal',
        color: COLORS.personal,
      });
    }
    const business = businessById.get(entityId);
    if (!business) return null;
    return upsertNode({
      id: `business::${business.id}`,
      name: business.name,
      layer: 'business',
      kind: 'business',
      color: business.color || COLORS.business,
    });
  };

  const links: SankeyDataLink[] = [];

  // Col 0 → Col 1/2: income categories → entity
  for (const [entityId, catMap] of incomeByEntityCategory.entries()) {
    const entityIdx = entityNodeFor(entityId);
    if (entityIdx === null) continue;
    for (const [category, amount] of catMap.entries()) {
      const incomeIdx = upsertNode({
        id: `income::${category}`,
        name: category,
        layer: 'income',
        kind: 'category',
        color: COLORS.income,
      });
      links.push({ source: incomeIdx, target: entityIdx, value: amount });
    }
  }

  // Col 1 → Col 2: business → personal (profit_distribution)
  for (const [pair, amount] of profitDistByPair.entries()) {
    const [fromId, toId] = pair.split('::');
    const fromIdx = entityNodeFor(fromId);
    const toIdx = entityNodeFor(toId);
    if (fromIdx === null || toIdx === null) continue;
    links.push({ source: fromIdx, target: toIdx, value: amount });
  }

  // Compute global expense totals to find < threshold categories
  const totalExpensesGlobal: number = Array.from(
    expenseByEntityCategory.values()
  ).reduce(
    (sum, m) => sum + Array.from(m.values()).reduce((a, b) => a + b, 0),
    0
  );
  const expenseTotalsByCategory = new Map<string, number>();
  for (const map of expenseByEntityCategory.values()) {
    for (const [cat, amt] of map.entries()) {
      expenseTotalsByCategory.set(cat, (expenseTotalsByCategory.get(cat) ?? 0) + amt);
    }
  }
  const threshold = totalExpensesGlobal * groupThreshold;
  const smallCategories = new Set<string>();
  for (const [cat, total] of expenseTotalsByCategory.entries()) {
    if (total < threshold) smallCategories.add(cat);
  }
  const othersSubItems: Array<{ name: string; value: number }> = Array.from(
    smallCategories
  )
    .map((cat) => ({ name: cat, value: expenseTotalsByCategory.get(cat) ?? 0 }))
    .sort((a, b) => b.value - a.value);

  // Col 1/2 → Col 3: entity → expense category (with "Others" grouping)
  for (const [entityId, catMap] of expenseByEntityCategory.entries()) {
    const entityIdx = entityNodeFor(entityId);
    if (entityIdx === null) continue;
    let othersValueForEntity = 0;
    for (const [category, amount] of catMap.entries()) {
      if (smallCategories.has(category)) {
        othersValueForEntity += amount;
        continue;
      }
      const expenseIdx = upsertNode({
        id: `expense::${category}`,
        name: category,
        layer: 'output',
        kind: 'expense',
        color: COLORS.expense,
      });
      links.push({ source: entityIdx, target: expenseIdx, value: amount });
    }
    if (othersValueForEntity > 0) {
      const othersIdx = upsertNode({
        id: 'expense::__others__',
        name: labels.others,
        layer: 'output',
        kind: 'others',
        color: COLORS.others,
        subItems: othersSubItems,
      });
      links.push({ source: entityIdx, target: othersIdx, value: othersValueForEntity });
    }
  }

  // Col 1/2 → Col 3: entity → investments
  let investmentsTotal = 0;
  for (const amount of investmentByEntity.values()) investmentsTotal += amount;
  if (investmentsTotal > 0) {
    const investmentIdx = upsertNode({
      id: 'output::investments',
      name: labels.investments,
      layer: 'output',
      kind: 'investment',
      color: COLORS.investment,
    });
    for (const [entityId, amount] of investmentByEntity.entries()) {
      const entityIdx = entityNodeFor(entityId);
      if (entityIdx === null) continue;
      links.push({ source: entityIdx, target: investmentIdx, value: amount });
    }
  }

  // Per-entity balance: inflow - outflow.
  //   balance > 0 → surplus: link entity → "{entity} Cash Kept" (sink)
  //   balance < 0 → deficit: link "From Reserves" → entity (virtual source)
  //
  // The deficit handling is critical for Sankey balance. Real data often has
  // entities (especially Personal) spending more than they earned in a given
  // period (covered by previous savings, credit card debt, etc.). Without a
  // virtual source, the diagram becomes mathematically unbalanced and
  // d3-sankey distorts node heights / link widths, producing weird S-curves.
  const inflow = new Map<number, number>();
  const outflow = new Map<number, number>();
  for (const link of links) {
    outflow.set(link.source, (outflow.get(link.source) ?? 0) + link.value);
    inflow.set(link.target, (inflow.get(link.target) ?? 0) + link.value);
  }

  let surplusTotal = 0;
  let deficitTotal = 0;
  let reservesIdx: number | null = null;

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    if (node.kind !== 'business' && node.kind !== 'personal') continue;
    const balance = (inflow.get(i) ?? 0) - (outflow.get(i) ?? 0);

    if (balance > 0.01) {
      const surplusIdx = upsertNode({
        id: `output::surplus::${node.id}`,
        name: `${node.name} · ${labels.surplus}`,
        layer: 'output',
        kind: 'surplus',
        color: COLORS.surplus,
      });
      links.push({ source: i, target: surplusIdx, value: balance });
      surplusTotal += balance;
    } else if (balance < -0.01) {
      if (reservesIdx === null) {
        reservesIdx = upsertNode({
          id: 'income::__reserves__',
          name: labels.reserves,
          layer: 'income',
          kind: 'reserves',
          color: COLORS.reserves,
        });
      }
      links.push({ source: reservesIdx, target: i, value: -balance });
      deficitTotal += -balance;
    }
  }

  // Real-income total — sum outflows of real income category nodes
  // (excluding the virtual "reserves" node which is also in the income layer).
  let incomeTotal = 0;
  const realIncomeIdxs = new Set<number>();
  for (let i = 0; i < nodes.length; i++) {
    if (nodes[i].kind === 'category') realIncomeIdxs.add(i);
  }
  for (const link of links) {
    if (realIncomeIdxs.has(link.source)) incomeTotal += link.value;
  }

  return {
    nodes,
    links,
    totals: {
      income: incomeTotal,
      expenses: totalExpensesGlobal,
      investments: investmentsTotal,
      surplus: surplusTotal,
      deficit: deficitTotal,
    },
  };
}
