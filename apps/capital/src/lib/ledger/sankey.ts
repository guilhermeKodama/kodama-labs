import type { FlowKind } from "@capital/server/modules/ledger/lib/flow-sql";

/**
 * Cash-flow sankey, "receita → PJ → PF → categorias" (decision sankey=v1).
 * Ported from the pre-ledger builder (git 16c4070f3^:src/lib/utils/
 * cashflow-sankey.ts) to work on the ledger's display rows: the server
 * (POST /v2/ledger/flows) sums the display rows of a selection into
 * FlowFacts and builds the graph here; the client draws it and names the
 * nodes (category, entity and the fixed labels) from their kind and ids.
 *
 * Columns: income categories → businesses → the person → expense
 * categories, Investimentos, transfers out and each entity's Sobra.
 * - Income and expense categories net per entity; a refund lowers its
 *   category. Categories under `groupThreshold` of all expenses fold into
 *   one "Outros" node (with subItems).
 * - A neutral transfer from a business to the person (profit distribution,
 *   reimbursement) is a business → person link. Other transfers between
 *   two entities (PF → PJ capital, PJ → PJ) leave the source through a
 *   transfer_out node and reach the destination from a transfer_in node,
 *   so the graph never cycles. Moves within one entity are not flows.
 * - A transfer only one leg of which is selected (an entity filter) is the
 *   same pair of nodes on the selected side.
 * - Aportes go to Investimentos; resgates come from "Das reservas". Broker
 *   buy/sell cash legs do not count and are ignored.
 * - Each entity balances: what is left is "<entity> · Sobra"; a shortfall
 *   comes from "Saldo anterior" (cash already in the accounts).
 */

export interface FlowFact {
  /** The display row's entity; for a neutral transfer, the origin. */
  entityId: string;
  counterpartEntityId: string | null;
  categoryId: string | null;
  flowKind: FlowKind;
  neutral: boolean;
  counts: boolean;
  /** Σ display amounts in base currency, signed (absolute for neutral transfers). */
  amount: number;
}

export interface FlowEntity {
  id: string;
  kind: "personal" | "business";
}

export type SankeyLayer = "income" | "business" | "personal" | "output";
export type SankeyNodeKind =
  | "category"
  | "business"
  | "personal"
  | "expense"
  | "investment"
  | "surplus"
  | "others"
  | "reserves"
  | "prior_balance"
  | "transfer_in"
  | "transfer_out";

export interface SankeyNode {
  id: string;
  kind: SankeyNodeKind;
  layer: SankeyLayer;
  /** Entity of an entity or surplus node; the other entity of a transfer_in/out node. */
  entityId: string | null;
  /** Category of an income ("category") or expense node; null = Sem categoria. */
  categoryId: string | null;
  /** "Outros": the expense categories folded into it, largest first. */
  subItems?: { categoryId: string | null; value: number }[];
}

export interface SankeyLink {
  source: number;
  target: number;
  value: number;
}

export interface CashflowSankey {
  nodes: SankeyNode[];
  links: SankeyLink[];
  totals: {
    /** Income categories (transfers in and virtual sources aside). */
    income: number;
    expenses: number;
    investments: number;
    surplus: number;
    /** Investment withdrawals (resgates). */
    reserves: number;
    /** Cash from before the period that covered a shortfall. */
    priorBalance: number;
  };
}

export interface BuildSankeyOptions {
  /** Share of total expenses under which a category folds into "Outros". Default 0.02. */
  groupThreshold?: number;
}

const EPSILON = 0.005;
const catKey = (categoryId: string | null) => categoryId ?? "none";

function add<K>(map: Map<K, number>, key: K, value: number) {
  map.set(key, (map.get(key) ?? 0) + value);
}

function addNested(map: Map<string, Map<string, number>>, outer: string, inner: string, value: number) {
  let m = map.get(outer);
  if (!m) map.set(outer, (m = new Map()));
  add(m, inner, value);
}

const byValueDesc = <T extends [string, number]>(entries: Iterable<T>) => [...entries].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

export function buildCashflowSankey(facts: FlowFact[], entities: FlowEntity[], options: BuildSankeyOptions = {}): CashflowSankey {
  const groupThreshold = options.groupThreshold ?? 0.02;
  const kindOf = new Map(entities.map((e) => [e.id, e.kind]));

  // ---- accumulate ----
  /** entity → "in|<cat>" / "out|<cat>" → net signed amount */
  const categoryNet = new Map<string, Map<string, number>>();
  const investmentByEntity = new Map<string, number>();
  const reservesByEntity = new Map<string, number>();
  /** "<business>::<person>" → amount */
  const entityLinks = new Map<string, number>();
  /** entity → other entity → amount */
  const transferOut = new Map<string, Map<string, number>>();
  const transferIn = new Map<string, Map<string, number>>();

  for (const fact of facts) {
    if (!kindOf.has(fact.entityId) || !fact.amount) continue;
    if (fact.neutral) {
      const to = fact.counterpartEntityId;
      if (!to || to === fact.entityId || !kindOf.has(to)) continue;
      const value = Math.abs(fact.amount);
      if (kindOf.get(fact.entityId) === "business" && kindOf.get(to) === "personal") {
        add(entityLinks, `${fact.entityId}::${to}`, value);
      } else {
        addNested(transferOut, fact.entityId, to, value);
        addNested(transferIn, to, fact.entityId, value);
      }
      continue;
    }
    if (!fact.counts) continue;
    switch (fact.flowKind) {
      case "in":
      case "out":
        addNested(categoryNet, fact.entityId, `${fact.flowKind}|${catKey(fact.categoryId)}`, fact.amount);
        break;
      case "invest":
        if (fact.amount < 0) add(investmentByEntity, fact.entityId, -fact.amount);
        else add(reservesByEntity, fact.entityId, fact.amount);
        break;
      case "transfer": {
        const other = fact.counterpartEntityId ?? fact.entityId;
        if (fact.amount > 0) addNested(transferIn, fact.entityId, other, fact.amount);
        else addNested(transferOut, fact.entityId, other, -fact.amount);
        break;
      }
    }
  }

  const incomeByEntity = new Map<string, Map<string, number>>();
  const expenseByEntity = new Map<string, Map<string, number>>();
  for (const [entityId, nets] of categoryNet) {
    for (const [key, net] of nets) {
      const cat = key.slice(key.indexOf("|") + 1);
      if (net > EPSILON) addNested(incomeByEntity, entityId, cat, net);
      else if (net < -EPSILON) addNested(expenseByEntity, entityId, cat, -net);
    }
  }

  // ---- nodes ----
  const nodes: SankeyNode[] = [];
  const index = new Map<string, number>();
  const node = (n: SankeyNode): number => {
    const existing = index.get(n.id);
    if (existing !== undefined) return existing;
    nodes.push(n);
    index.set(n.id, nodes.length - 1);
    return nodes.length - 1;
  };
  const links: SankeyLink[] = [];
  const link = (source: number, target: number, value: number) => {
    if (value > EPSILON) links.push({ source, target, value });
  };
  const categoryId = (key: string) => (key === "none" ? null : key);

  // Entity nodes in layer order: businesses, then the person.
  const involved = new Set<string>([
    ...incomeByEntity.keys(),
    ...expenseByEntity.keys(),
    ...investmentByEntity.keys(),
    ...reservesByEntity.keys(),
    ...transferOut.keys(),
    ...transferIn.keys(),
    ...[...entityLinks.keys()].flatMap((k) => k.split("::")),
  ]);
  const entityNode = (entityId: string) => {
    const kind = kindOf.get(entityId) === "personal" ? "personal" : "business";
    return node({ id: `entity::${entityId}`, kind, layer: kind, entityId, categoryId: null });
  };

  // Column 0 → 1/2: income categories → entity.
  for (const entityId of [...involved].sort((a, b) => (kindOf.get(a) === kindOf.get(b) ? 0 : kindOf.get(a) === "business" ? -1 : 1))) {
    const target = entityNode(entityId);
    for (const [cat, value] of byValueDesc(incomeByEntity.get(entityId) ?? [])) {
      link(node({ id: `income::${cat}`, kind: "category", layer: "income", entityId: null, categoryId: categoryId(cat) }), target, value);
    }
    for (const [other, value] of byValueDesc(transferIn.get(entityId) ?? [])) {
      link(node({ id: `in::${other}`, kind: "transfer_in", layer: "income", entityId: other, categoryId: null }), target, value);
    }
  }

  // Column 1 → 2: business → person.
  for (const [pair, value] of byValueDesc(entityLinks)) {
    const [from, to] = pair.split("::");
    link(entityNode(from), entityNode(to), value);
  }

  // Expense categories, the small ones folded into "Outros".
  const expenseTotals = new Map<string, number>();
  for (const cats of expenseByEntity.values()) for (const [cat, value] of cats) add(expenseTotals, cat, value);
  const expensesTotal = [...expenseTotals.values()].reduce((s, v) => s + v, 0);
  const small = new Set([...expenseTotals].filter(([, total]) => total < expensesTotal * groupThreshold).map(([cat]) => cat));
  const subItems = byValueDesc([...expenseTotals].filter(([cat]) => small.has(cat))).map(([cat, value]) => ({ categoryId: categoryId(cat), value }));

  for (const [entityId, cats] of expenseByEntity) {
    const source = entityNode(entityId);
    let others = 0;
    for (const [cat, value] of byValueDesc(cats)) {
      if (small.has(cat)) others += value;
      else link(source, node({ id: `expense::${cat}`, kind: "expense", layer: "output", entityId: null, categoryId: categoryId(cat) }), value);
    }
    if (others > EPSILON) {
      link(source, node({ id: "expense::__others__", kind: "others", layer: "output", entityId: null, categoryId: null, subItems }), others);
    }
  }

  // Investments, transfers out.
  const investmentsTotal = [...investmentByEntity.values()].reduce((s, v) => s + v, 0);
  for (const [entityId, value] of byValueDesc(investmentByEntity)) {
    link(entityNode(entityId), node({ id: "output::investments", kind: "investment", layer: "output", entityId: null, categoryId: null }), value);
  }
  for (const [entityId, others] of transferOut) {
    for (const [other, value] of byValueDesc(others)) {
      link(entityNode(entityId), node({ id: `out::${other}`, kind: "transfer_out", layer: "output", entityId: other, categoryId: null }), value);
    }
  }

  // Resgates come in from "Das reservas" (before balancing, they cover shortfalls).
  let reservesTotal = 0;
  for (const [entityId, value] of byValueDesc(reservesByEntity)) {
    link(node({ id: "income::__reserves__", kind: "reserves", layer: "income", entityId: null, categoryId: null }), entityNode(entityId), value);
    reservesTotal += value;
  }

  // Balance each entity: Sobra, or Saldo anterior for a shortfall.
  const inflow = new Map<number, number>();
  const outflow = new Map<number, number>();
  for (const l of links) {
    add(outflow, l.source, l.value);
    add(inflow, l.target, l.value);
  }
  let surplusTotal = 0;
  let priorBalanceTotal = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.kind !== "business" && n.kind !== "personal") continue;
    const balance = (inflow.get(i) ?? 0) - (outflow.get(i) ?? 0);
    if (balance > EPSILON) {
      link(i, node({ id: `surplus::${n.entityId}`, kind: "surplus", layer: "output", entityId: n.entityId, categoryId: null }), balance);
      surplusTotal += balance;
    } else if (balance < -EPSILON) {
      link(node({ id: "income::__prior_balance__", kind: "prior_balance", layer: "income", entityId: null, categoryId: null }), i, -balance);
      priorBalanceTotal += -balance;
    }
  }

  const incomeTotal = links.filter((l) => nodes[l.source].kind === "category").reduce((s, l) => s + l.value, 0);
  return {
    nodes,
    links,
    totals: {
      income: incomeTotal,
      expenses: expensesTotal,
      investments: investmentsTotal,
      surplus: surplusTotal,
      reserves: reservesTotal,
      priorBalance: priorBalanceTotal,
    },
  };
}
