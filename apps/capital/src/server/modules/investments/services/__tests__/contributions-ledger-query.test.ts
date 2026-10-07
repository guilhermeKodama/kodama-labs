import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { queryLedger } from "@capital/server/modules/ledger/services/query-engine";
import type { LedgerDisplayQueryResult } from "@capital/server/modules/ledger/contracts";
import {
  contributionRow,
  contributionsQuery,
  contributionTotalsBody,
  EMPTY_CONTRIBUTION_FILTERS,
  totalsFromGroups,
  type ContributionFilters,
} from "@/lib/invest/contributions-ledger";

/**
 * Aportes › "Todos os aportes" end to end on the ledger engine: the page
 * query lists every aporte and resgate (one row per transfer, never an
 * ordinary transfer or expense), the chips narrow it, and the totals cover
 * the whole selection (not only the loaded page), signed by direction
 * whichever leg the filters keep.
 */
const USER = "test-user-invest-all-contributions-001";
let f: LedgerFixture;
let otherBroker: string;

const run = async (filters: Partial<ContributionFilters>, scope: "all" | "pf" | "pj" = "all") => {
  const q = contributionsQuery({ ...EMPTY_CONTRIBUTION_FILTERS, ...filters }, scope);
  const page = (await queryLedger(USER, q.body, prisma)) as LedgerDisplayQueryResult;
  const rows = (q.clientFilter ? page.rows.filter(q.clientFilter) : page.rows).map(contributionRow);
  const totalsBody = contributionTotalsBody(q);
  const totals = totalsBody ? totalsFromGroups(((await queryLedger(USER, totalsBody, prisma)) as LedgerDisplayQueryResult).groups) : null;
  return { rows, totals, page };
};

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  otherBroker = (await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "Corretora PJ", currency: "BRL" } })).id;
  const transfer = (fromAccountId: string, toAccountId: string, amount: number, date: string, direction?: "investment_deposit" | "investment_withdrawal", description?: string) =>
    createEntry(USER, { kind: "transfer", fromAccountId, toAccountId, amount, date, ...(direction && { direction }), ...(description && { description }) }, prisma);
  await transfer(f.pfChecking, f.broker, 1000, "2026-07-05", "investment_deposit", "Salário julho");
  await transfer(f.pfChecking, f.broker, 2500, "2026-08-05", "investment_deposit");
  await transfer(f.broker, f.pfChecking, 800, "2026-08-20", "investment_withdrawal");
  await transfer(f.pjChecking, otherBroker, 4000, "2026-09-02", "investment_deposit");
  // Not aportes: an ordinary transfer and an expense.
  await transfer(f.pjChecking, f.pfChecking, 3000, "2026-09-10");
  await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 120, description: "Mercado", date: "2026-09-11" }, prisma, { skipRules: true });
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

describe("Todos os aportes on the ledger", () => {
  it("lists every aporte and resgate once, newest first, with totals over the whole selection", async () => {
    const { rows, totals } = await run({});
    expect(rows.map((r) => [r.date, r.direction, r.amount])).toEqual([
      ["2026-09-02", "investment_deposit", 4000],
      ["2026-08-20", "investment_withdrawal", -800],
      ["2026-08-05", "investment_deposit", 2500],
      ["2026-07-05", "investment_deposit", 1000],
    ]);
    expect(rows[1]).toMatchObject({ brokerAccountId: f.broker, otherAccountId: f.pfChecking });
    expect(totals).toEqual({ deposits: 7500, withdrawals: 800, net: 6700 });
  });

  it("keeps the totals of every page when a page holds fewer rows", async () => {
    const q = contributionsQuery(EMPTY_CONTRIBUTION_FILTERS);
    const first = (await queryLedger(USER, { ...q.body, page: { limit: 2 } }, prisma)) as LedgerDisplayQueryResult;
    expect(first.rows).toHaveLength(2);
    expect(first.pageInfo.hasMore).toBe(true);
    const body = contributionTotalsBody(q)!;
    expect(totalsFromGroups(((await queryLedger(USER, body, prisma)) as LedgerDisplayQueryResult).groups)).toEqual({ deposits: 7500, withdrawals: 800, net: 6700 });
  });

  it("narrows by Corretora (broker leg), Conta (bank leg), Tipo and scope with the same signs", async () => {
    const broker = await run({ brokerIds: [f.broker] });
    expect(broker.rows.map((r) => r.amount)).toEqual([-800, 2500, 1000]);
    expect(broker.totals).toEqual({ deposits: 3500, withdrawals: 800, net: 2700 });

    const account = await run({ accountIds: [f.pjChecking] });
    expect(account.rows.map((r) => [r.brokerAccountId, r.amount])).toEqual([[otherBroker, 4000]]);
    expect(account.totals).toEqual({ deposits: 4000, withdrawals: 0, net: 4000 });

    const resgates = await run({ directions: ["investment_withdrawal"] });
    expect(resgates.totals).toEqual({ deposits: 0, withdrawals: 800, net: -800 });

    expect((await run({}, "pj")).totals).toEqual({ deposits: 4000, withdrawals: 0, net: 4000 });
    expect((await run({ period: "all", search: "Salário" })).rows.map((r) => r.amount)).toEqual([1000]);
  });

  it("matches Conta with Corretora on the client (no server totals)", async () => {
    const both = await run({ brokerIds: [f.broker], accountIds: [f.pjChecking] });
    expect(both.rows).toEqual([]);
    expect(both.totals).toBeNull();
    expect((await run({ brokerIds: [otherBroker], accountIds: [f.pjChecking] })).rows.map((r) => r.amount)).toEqual([4000]);
  });
});
