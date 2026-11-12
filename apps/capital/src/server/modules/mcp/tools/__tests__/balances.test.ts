import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { loadFx } from "@capital/server/modules/ledger/lib/fx";
import { round } from "@capital/server/modules/ledger/lib/money";
import { accountBalances, listAccounts } from "@capital/server/modules/ledger/services/accounts";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { listAccountBalances } from "../balances";

const USER = "test-user-mcp-balances-001";
const OTHER = "test-user-mcp-balances-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { usdRate: 0.2 });
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

/** End of a calendar day, matching listAccountBalances. */
function endOfDay(day: string): Date {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date, 23, 59, 59, 999));
}

describe("listAccountBalances", () => {
  it("matches the accounts screen and the portfolio's base-currency conversion", async () => {
    await prisma.account.create({
      data: { userId: USER, entityId: f.pfId, type: "cash", name: "Espécie", currency: "BRL", initialBalance: 80 },
    });
    const usd = await prisma.account.create({
      data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "IBKR", currency: "USD", initialBalance: 10 },
    });
    await prisma.account.create({
      data: { userId: USER, entityId: f.pfId, type: "cash", name: "Arquivada", currency: "BRL", archivedAt: new Date() },
    });
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 200, date: "2026-08-01", description: "in" }, prisma);
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 50, date: "2026-09-01", description: "out" }, prisma);

    const listed = await listAccountBalances(USER, {}, prisma);
    const ui = await listAccounts(USER, prisma);
    const fx = await loadFx(USER, prisma);
    const ids = listed.accounts.map((account) => account.id);

    expect(listed.baseCurrency).toBe("BRL");
    expect(listed.asOf).toBeNull();
    expect(ids).not.toContain(f.card);
    expect(listed.accounts.map((account) => account.name)).not.toContain("Arquivada");
    expect(ids).toEqual(expect.arrayContaining([f.pfChecking, f.pjChecking, f.broker, usd.id]));
    expect((await listAccountBalances(OTHER, {}, prisma)).accounts.map((account) => account.id)).not.toEqual(expect.arrayContaining(ids));

    for (const row of listed.accounts) {
      const screen = ui.find((account) => account.id === row.id);
      expect(screen?.balance).toBe(row.balance);
      expect(row.balanceBase).toBe(round(row.balance * fx.rateFor(row.currency), 2));
    }
    expect(listed.accounts.find((account) => account.id === f.pfChecking)).toMatchObject({ entity: "PF", currency: "BRL", balance: 150, balanceBase: 150 });
    expect(listed.accounts.find((account) => account.id === f.pjChecking)).toMatchObject({ entity: "PJ", name: "Conta principal" });
    expect(listed.accounts.find((account) => account.id === usd.id)).toMatchObject({ entity: "PJ", currency: "USD", balance: 10, balanceBase: 50 });

    const asOf = await listAccountBalances(USER, { asOf: "2026-08-15" }, prisma);
    const historical = await accountBalances(USER, prisma, [f.pfChecking], endOfDay("2026-08-15"));
    expect(asOf.asOf).toBe("2026-08-15");
    expect(asOf.accounts.find((account) => account.id === f.pfChecking)?.balance).toBe(historical.get(f.pfChecking));
    expect(asOf.accounts.find((account) => account.id === f.pfChecking)).toMatchObject({ balance: 200, balanceBase: 200 });
    expect(asOf.accounts.find((account) => account.id === usd.id)?.balanceBase).toBe(round(10 * fx.rateOn("USD", endOfDay("2026-08-15")), 2));
  });
});
