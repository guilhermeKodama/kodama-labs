import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { createEntry } from "../../services/entries";
import { flowKindJoins, flowKindOf, flowKindSql, type FlowKind } from "../flow-sql";

const USER = "test-user-ledger-flow-sql-001";
let f: LedgerFixture;

describe("flowKindOf", () => {
  const row = { kind: "expense", transferGroupId: null, direction: null, operationType: null } as const;

  it("classifies entries, transfers and investment legs", () => {
    expect(flowKindOf({ ...row, kind: "income" })).toBe("in");
    expect(flowKindOf(row)).toBe("out");
    expect(flowKindOf({ ...row, kind: "transfer", transferGroupId: "g", direction: "between_accounts" })).toBe("transfer");
    expect(flowKindOf({ ...row, kind: "transfer", transferGroupId: "g", direction: "investment_deposit" })).toBe("invest");
    expect(flowKindOf({ ...row, kind: "transfer", transferGroupId: "g", direction: "investment_withdrawal" })).toBe("invest");
    // Reimbursement legs are booked as expenses but only move money between entities.
    expect(flowKindOf({ ...row, transferGroupId: "g", direction: "reimbursement" })).toBe("transfer");
    expect(flowKindOf({ ...row, kind: "investment", operationType: "buy" })).toBe("invest");
    expect(flowKindOf({ ...row, kind: "investment", operationType: "split" })).toBe("invest");
    expect(flowKindOf({ ...row, kind: "investment", operationType: null })).toBe("invest");
    expect(flowKindOf({ ...row, kind: "investment", operationType: "dividend" })).toBe("in");
    expect(flowKindOf({ ...row, kind: "investment", operationType: "yield_payment" })).toBe("in");
  });

  it("rejects aliases that are not plain identifiers", () => {
    expect(() => flowKindSql({ entry: "le; DROP TABLE x" })).toThrow(/Invalid SQL alias/);
  });
});

describe("flowKindSql", () => {
  beforeAll(async () => {
    f = await createLedgerFixture(prisma, USER);
  });

  afterAll(async () => {
    await deleteLedgerFixture(prisma, USER);
  });

  it("agrees with flowKindOf on every kind of row", async () => {
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 100, description: "Salário", date: "2026-09-01" }, prisma);
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, description: "Café", date: "2026-09-01" }, prisma);
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 50, date: "2026-09-02" }, prisma);
    await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 20, date: "2026-09-02", direction: "reimbursement" }, prisma);
    const h = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "TAEE11", name: "Taesa" }, prisma);
    await recordOperation(USER, { holdingId: h.id, type: "buy", quantity: 1, pricePerUnit: 40, totalAmount: 40, date: "2026-09-03", fundFromAccountId: f.pfChecking }, prisma);
    await recordOperation(USER, { holdingId: h.id, type: "dividend", totalAmount: 2, date: "2026-09-04" }, prisma);

    const rows = await prisma.$queryRaw<{ id: string; flow_kind: FlowKind }[]>`
      SELECT le.id, ${flowKindSql()} AS flow_kind
      FROM ledger_entries le ${flowKindJoins()}
      WHERE le."userId" = ${USER}`;
    const entries = await prisma.ledgerEntry.findMany({ where: { userId: USER }, include: { transferGroup: true, investmentOperation: true } });
    const expected = Object.fromEntries(
      entries.map((e) => [e.id, flowKindOf({ kind: e.kind, transferGroupId: e.transferGroupId, direction: e.transferGroup?.direction ?? null, operationType: e.investmentOperation?.type ?? null })])
    );
    expect(Object.fromEntries(rows.map((r) => [r.id, r.flow_kind]))).toEqual(expected);
    expect(Object.values(expected).sort()).toEqual(["in", "in", "invest", "invest", "invest", "out", "transfer", "transfer", "transfer", "transfer"]);
  });

  it("takes other aliases", async () => {
    const [row] = await prisma.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM ledger_entries e ${flowKindJoins({ entry: "e", group: "g", operation: "o" })}
      WHERE e."userId" = ${USER} AND ${flowKindSql({ entry: "e", group: "g", operation: "o" })} = ${Prisma.raw("'out'")}`;
    expect(row.n).toBe(1);
  });
});
