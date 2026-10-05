import { createRoute, z } from "@hono/zod-openapi";
import { createRouter } from "@capital/server/lib/router";
import { prisma } from "@capital/server/lib/prisma";
import { idParams, jsonBody, v2Handler, v2Responses } from "@capital/server/lib/v2";
import { LedgerError } from "../../lib/errors";
import { markStatementPayment, unmarkStatementPayment } from "../../services/statements";

const tags = ["Ledger v2"];

const statementsRoute = createRoute({ method: "get", path: "/v2/accounts/{id}/statements", tags, summary: "Card statements with totals", request: { params: idParams }, responses: v2Responses });
const markPaymentRoute = createRoute({
  method: "post",
  path: "/v2/card-statements/{id}/payment",
  tags,
  summary: "Mark an expense as the payment of a statement",
  request: { params: idParams, ...jsonBody(z.object({ entryId: z.string() })) },
  responses: v2Responses,
});
const unmarkPaymentRoute = createRoute({
  method: "delete",
  path: "/v2/card-statements/payment/{id}",
  tags,
  summary: "Undo a statement payment link (id = checking-leg entry id)",
  request: { params: idParams },
  responses: v2Responses,
});

export const ledgerStatementRoutes = createRouter()
  .openapi(
    statementsRoute,
    v2Handler(statementsRoute, async (c, userId) => {
      const accountId = c.req.valid("param").id;
      const account = await prisma.account.findFirst({ where: { id: accountId, userId } });
      if (!account) throw new LedgerError("Account not found", 404, { code: "account.not_found" });
      const statements = await prisma.cardStatement.findMany({ where: { accountId }, orderBy: { month: "desc" } });
      const totals = await prisma.ledgerEntry.groupBy({
        by: ["cardStatementId"],
        where: { accountId, deletedAt: null, cardStatementId: { in: statements.map((s) => s.id) } },
        _sum: { amountBase: true, amount: true },
        _count: true,
      });
      const byId = new Map(totals.map((t) => [t.cardStatementId, t]));
      return statements.map((s) => ({
        id: s.id,
        month: s.month,
        closingDate: s.closingDate,
        dueDate: s.dueDate,
        declaredTotal: s.totalAmount == null ? null : Number(s.totalAmount),
        purchasesTotal: -Number(byId.get(s.id)?._sum.amount ?? 0),
        purchaseCount: byId.get(s.id)?._count ?? 0,
        paymentGroupId: s.paymentGroupId,
      }));
    })
  )
  .openapi(markPaymentRoute, v2Handler(markPaymentRoute, (c, userId) => markStatementPayment(userId, c.req.valid("json").entryId, c.req.valid("param").id, prisma)))
  .openapi(unmarkPaymentRoute, v2Handler(unmarkPaymentRoute, (c, userId) => unmarkStatementPayment(userId, c.req.valid("param").id, prisma)));
