import type { DbClient } from "@capital/server/lib/prisma";
import type { Prisma } from "@/generated/prisma";
import { buildCashflowSankey, type CashflowSankey, type FlowFact } from "@/lib/ledger/sankey";
import { z } from "zod";
import { ledgerSelectionQuerySchema } from "../contracts";
import type { FlowKind } from "../lib/flow-sql";
import { toNumber } from "../lib/money";
import { displayRowsSource } from "./query-engine";

/** POST /v2/ledger/flows: a selection (period, filters, search) and the "Outros" threshold. */
export const ledgerFlowsInputSchema = ledgerSelectionQuerySchema.extend({
  /** Share of total expenses under which a category folds into "Outros". */
  groupThreshold: z.number().min(0).max(0.5).default(0.02),
});
export type LedgerFlowsInput = z.input<typeof ledgerFlowsInputSchema>;

export type LedgerFlowsResult = CashflowSankey & { range: { from: string | null; to: string | null } };

/**
 * The cash-flow sankey ("receita → PJ → PF → categorias") of a selection:
 * its display rows summed per entity, counterpart, category, flowKind and
 * sign, then laid out by buildCashflowSankey (src/lib/ledger/sankey.ts).
 */
export async function cashflowSankey(userId: string, input: LedgerFlowsInput, db: DbClient): Promise<LedgerFlowsResult> {
  const { groupThreshold, ...selection } = ledgerFlowsInputSchema.parse(input);
  const { cte, range } = await displayRowsSource(userId, selection, db);
  const [rows, entities] = await Promise.all([
    db.$queryRaw<
      { entityId: string; cp_entity: string | null; categoryId: string | null; flowKind: FlowKind; neutral: boolean; counts: boolean; amount: Prisma.Decimal }[]
    >`
      ${cte}
      SELECT src."entityId", src.cp_entity, src."categoryId", src."flowKind", src.neutral, src.counts, coalesce(sum(src.display_amount), 0) AS amount
      FROM src
      GROUP BY 1, 2, 3, 4, 5, 6, (src.display_amount > 0)
      ORDER BY 1, 2, 3, 4`,
    db.entity.findMany({ where: { userId }, select: { id: true, kind: true } }),
  ]);
  const facts: FlowFact[] = rows.map((r) => ({
    entityId: r.entityId,
    counterpartEntityId: r.cp_entity,
    categoryId: r.categoryId,
    flowKind: r.flowKind,
    neutral: r.neutral,
    counts: r.counts,
    amount: toNumber(r.amount),
  }));
  return { ...buildCashflowSankey(facts, entities, { groupThreshold }), range };
}
