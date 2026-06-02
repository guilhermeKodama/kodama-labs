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
  | 'reserves'
  | 'prior_balance';

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
    /** Sum of real reserve withdrawals (investment_withdrawal transfers). */
    reserves: number;
    /**
     * Cash drawn from prior-period balance to cover a deficit — not a real
     * "reserve" withdrawal. Shown as a separate, neutral-colored node.
     */
    priorBalance: number;
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
    priorBalance?: string;
    profitDistribution?: string;
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
  priorBalance: '#64748b',
};

const DEFAULT_LABELS = {
  personal: 'Personal',
  others: 'Others',
  investments: 'Investments',
  surplus: 'Surplus',
  uncategorized: 'Uncategorized',
  reserves: 'From Reserves',
  priorBalance: 'Prior Balance',
  profitDistribution: 'Profit Distribution',
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
  // entityId → amount (real reserve withdrawals: investment_withdrawal transfers).
  // Surfaced as a "From Reserves" virtual source node — distinct from the
  // virtual "Prior Balance" node which only covers period deficit.
  const withdrawalByEntity = new Map<string, number>();

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
  // Handles: profit_distribution (business → personal), investment_deposit
  // (outflow to the investments sink), and investment_withdrawal (inflow from
  // a virtual "From Reserves" source — the only case where the term applies).
  // Reimbursement and capital_injection are still skipped — they tend to be
  // small relative to the main flow.
  for (const tr of transfers) {
    if (!inRange(tr.date)) continue;
    const amount = tr.amount * tr.exchangeRate;
    if (amount <= 0) continue;

    if (tr.direction === 'profit_distribution') {
      if (!businessById.has(tr.fromEntityId) || !isPersonal(tr.toEntityId)) continue;
      const fromMatched = matchesEntity(tr.fromEntityId);
      const toMatched = matchesEntity(tr.toEntityId);
      if (!fromMatched && !toMatched) continue;

      // When the source business is filtered out but the destination is
      // included, the cross-entity link can't be drawn without rendering the
      // business as a ghost node (no inflow → would spuriously create a
      // "Prior Balance" deficit for its outflow). Treat the received amount
      // as direct external income to the destination entity instead.
      if (entityFilterActive && !fromMatched && toMatched) {
        addToMapMap(
          incomeByEntityCategory,
          tr.toEntityId,
          labels.profitDistribution,
          amount
        );
        continue;
      }

      const key = `${tr.fromEntityId}::${tr.toEntityId}`;
      profitDistByPair.set(key, (profitDistByPair.get(key) ?? 0) + amount);
    } else if (tr.direction === 'investment_deposit') {
      if (!matchesEntity(tr.fromEntityId)) continue;
      if (!isKnownEntity(tr.fromEntityId)) continue;
      investmentByEntity.set(
        tr.fromEntityId,
        (investmentByEntity.get(tr.fromEntityId) ?? 0) + amount
      );
    } else if (tr.direction === 'investment_withdrawal') {
      if (!matchesEntity(tr.toEntityId)) continue;
      if (!isKnownEntity(tr.toEntityId)) continue;
      withdrawalByEntity.set(
        tr.toEntityId,
        (withdrawalByEntity.get(tr.toEntityId) ?? 0) + amount
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

  // Real reserve withdrawals (investment_withdrawal): "From Reserves" → entity.
  // These are genuine inflows from liquidated investments — they reduce the
  // residual deficit handled below, so create them BEFORE the balance pass.
  let reservesTotal = 0;
  let reservesIdx: number | null = null;
  if (withdrawalByEntity.size > 0) {
    reservesIdx = upsertNode({
      id: 'income::__reserves__',
      name: labels.reserves,
      layer: 'income',
      kind: 'reserves',
      color: COLORS.reserves,
    });
    for (const [entityId, amount] of withdrawalByEntity.entries()) {
      const entityIdx = entityNodeFor(entityId);
      if (entityIdx === null) continue;
      links.push({ source: reservesIdx, target: entityIdx, value: amount });
      reservesTotal += amount;
    }
  }

  // Per-entity balance: inflow - outflow.
  //   balance > 0 → surplus: link entity → "{entity} Cash Kept" (sink)
  //   balance < 0 → residual deficit: link "Prior Balance" → entity (virtual)
  //
  // The deficit handling is critical for Sankey balance. Real data often has
  // entities (especially Personal) spending more than they earned in a given
  // period — but the gap is normally covered by cash that was already sitting
  // in the account, NOT by liquidating an investment. We surface this as a
  // distinct, neutral "Prior Balance" node to avoid implying a real reserve
  // withdrawal happened (which is reserved for investment_withdrawal above).
  const inflow = new Map<number, number>();
  const outflow = new Map<number, number>();
  for (const link of links) {
    outflow.set(link.source, (outflow.get(link.source) ?? 0) + link.value);
    inflow.set(link.target, (inflow.get(link.target) ?? 0) + link.value);
  }

  let surplusTotal = 0;
  let priorBalanceTotal = 0;
  let priorBalanceIdx: number | null = null;

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
      if (priorBalanceIdx === null) {
        priorBalanceIdx = upsertNode({
          id: 'income::__prior_balance__',
          name: labels.priorBalance,
          layer: 'income',
          kind: 'prior_balance',
          color: COLORS.priorBalance,
        });
      }
      links.push({ source: priorBalanceIdx, target: i, value: -balance });
      priorBalanceTotal += -balance;
    }
  }

  // Real-income total — sum outflows of real income category nodes
  // (excluding virtual "reserves" / "prior balance" nodes in the income layer).
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
      reserves: reservesTotal,
      priorBalance: priorBalanceTotal,
    },
  };
}
