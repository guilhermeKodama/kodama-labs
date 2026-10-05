import { Prisma } from "@/generated/prisma";
import type { InvestmentTransactionType, LedgerKind, TransferDirection } from "@/generated/prisma";

/**
 * flowKind, the derived "Tipo" of a ledger row: what the money did, not how
 * it was booked.
 *
 * - invest: money into or out of a broker (investment_deposit/withdrawal
 *   transfers) and the cash legs of buys, sells, applications, redemptions,
 *   splits and adjustments;
 * - in: income entries and the cash legs of dividends and yields;
 * - out: expense entries;
 * - transfer: every other transfer, reimbursement groups included (their
 *   legs are booked as expenses, but the money only changes hands).
 *
 * The SQL expression and flowKindOf() are the single definition; the query
 * engine's display mode, contributions and the savings rate use them.
 */
export const FLOW_KINDS = ["in", "out", "invest", "transfer"] as const;
export type FlowKind = (typeof FLOW_KINDS)[number];

const INVEST_DIRECTIONS = ["investment_deposit", "investment_withdrawal"] as const satisfies readonly TransferDirection[];
const INCOME_OPERATIONS = ["dividend", "yield_payment"] as const satisfies readonly InvestmentTransactionType[];

export interface FlowKindInput {
  kind: LedgerKind;
  transferGroupId: string | null;
  /** The transfer group's direction, when the row is a transfer leg. */
  direction: TransferDirection | null;
  /** Type of the investment operation whose cash leg this row is. */
  operationType: InvestmentTransactionType | null;
}

export function flowKindOf(row: FlowKindInput): FlowKind {
  if (row.direction && (INVEST_DIRECTIONS as readonly string[]).includes(row.direction)) return "invest";
  if (row.transferGroupId) return "transfer";
  if (row.kind === "investment") return row.operationType && (INCOME_OPERATIONS as readonly string[]).includes(row.operationType) ? "in" : "invest";
  if (row.kind === "income") return "in";
  if (row.kind === "expense") return "out";
  return "transfer";
}

/** Table aliases the expression refers to: ledger_entries, transfer_groups and investment_operations. */
export interface FlowKindAliases {
  entry: string;
  group: string;
  operation: string;
}

const DEFAULT_ALIASES: FlowKindAliases = { entry: "le", group: "tg", operation: "io" };

function alias(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`Invalid SQL alias "${name}"`);
  return Prisma.raw(name);
}

// Enum literals inlined: a bound text parameter cannot be compared with an enum column.
const literals = (values: readonly string[]) => Prisma.raw(values.map((v) => `'${v}'`).join(", "));

/** `flow_kind` as SQL ('in' | 'out' | 'invest' | 'transfer'); needs the joins of flowKindJoins(). */
export function flowKindSql(aliases: Partial<FlowKindAliases> = {}): Prisma.Sql {
  const a = { ...DEFAULT_ALIASES, ...aliases };
  const [e, g, o] = [alias(a.entry), alias(a.group), alias(a.operation)];
  return Prisma.sql`(CASE
    WHEN ${g}.direction IN (${literals(INVEST_DIRECTIONS)}) THEN 'invest'
    WHEN ${e}."transferGroupId" IS NOT NULL THEN 'transfer'
    WHEN ${e}.kind = 'investment' THEN CASE WHEN ${o}.type IN (${literals(INCOME_OPERATIONS)}) THEN 'in' ELSE 'invest' END
    WHEN ${e}.kind = 'income' THEN 'in'
    WHEN ${e}.kind = 'expense' THEN 'out'
    ELSE 'transfer' END)`;
}

/** The LEFT JOINs flowKindSql() reads from, for a query over ledger_entries aliased `entry`. */
export function flowKindJoins(aliases: Partial<FlowKindAliases> = {}): Prisma.Sql {
  const a = { ...DEFAULT_ALIASES, ...aliases };
  const [e, g, o] = [alias(a.entry), alias(a.group), alias(a.operation)];
  return Prisma.sql`LEFT JOIN transfer_groups ${g} ON ${g}.id = ${e}."transferGroupId"
    LEFT JOIN investment_operations ${o} ON ${o}."cashEntryId" = ${e}.id`;
}
