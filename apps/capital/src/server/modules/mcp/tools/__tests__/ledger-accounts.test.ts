import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { accountBalances } from "@capital/server/modules/ledger/services/accounts";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { bulkCreateTransactions } from "../bulk-create-transactions";
import { archiveLedgerAccount, createLedgerAccount } from "../ledger-accounts";
import { listAccounts } from "../metadata";
import { listLedgerAccounts } from "../transfers";

const USER = "test-user-mcp-ledger-accounts-001";
const OTHER = "test-user-mcp-ledger-accounts-002";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER, { categories: [{ name: "Software", type: "expense" }] });
  await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const balance = async (accountId: string) => (await accountBalances(USER, prisma, [accountId])).get(accountId);

describe("create_account", () => {
  it("stores the opening balance on the account and does not write a ledger entry", async () => {
    const created = await createLedgerAccount(
      USER,
      { name: "Inter PJ", type: "checking", entityType: "business", businessId: f.pjId, currency: "brl", initialBalance: 1500.5, date: "2026-01-01" },
      prisma,
    );
    expect(created).toMatchObject({
      name: "Inter PJ",
      type: "checking",
      currency: "BRL",
      entityId: f.pjId,
      businessId: f.pjId,
      personalAccountId: null,
      isDefault: false,
      archived: false,
      initialBalance: 1500.5,
      balance: 1500.5,
      note: expect.stringContaining("no opening-balance date"),
    });
    expect(created.batchId).toBeTruthy();
    expect(await prisma.ledgerEntry.count({ where: { accountId: created.id } })).toBe(0);
    expect(await balance(created.id)).toBe(1500.5);

    await undoBatch(USER, created.batchId, prisma);
    expect(await prisma.account.findUnique({ where: { id: created.id } })).toBeNull();
  });

  it("creates a brokerage on the personal entity and a card with the card fields", async () => {
    const broker = await createLedgerAccount(USER, { name: "Avenue", type: "brokerage", entityType: "personal", currency: "USD" }, prisma);
    expect(broker).toMatchObject({ entityId: f.pfId, personalAccountId: f.pfId, currency: "USD", initialBalance: 0, isDefault: false });
    expect(broker.note).toBeUndefined();

    await expect(createLedgerAccount(USER, { name: "Visa", type: "credit_card", entityType: "personal", currency: "BRL" }, prisma)).rejects.toThrow(/closingDay/);
    const card = await createLedgerAccount(
      USER,
      { name: "Visa", type: "credit_card", entityType: "personal", currency: "BRL", creditLimit: 8000, closingDay: 5, dueDay: 12 },
      prisma,
    );
    expect(card).toMatchObject({ type: "credit_card", entityId: f.pfId });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: card.id } })).payFromAccountId).toBe(f.pfChecking);
  });

  it("refuses another user's business and a business id without saying which", async () => {
    await expect(createLedgerAccount(USER, { name: "X", type: "checking", entityType: "business", businessId: f.pjId }, prisma)).resolves.toMatchObject({ entityId: f.pjId });
    await expect(createLedgerAccount(OTHER, { name: "X", type: "checking", entityType: "business", businessId: f.pjId }, prisma)).rejects.toThrow(/not found/);
    await expect(createLedgerAccount(USER, { name: "X", type: "cash", entityType: "business" }, prisma)).rejects.toThrow(/businessId is required/);
  });
});

describe("archive_account and the lists", () => {
  it("hides an archived account, refuses a non-zero balance, and rejects new transactions", async () => {
    const inter = await createLedgerAccount(USER, { name: "Inter PJ", type: "checking", entityType: "business", businessId: f.pjId, initialBalance: 40 }, prisma);
    await expect(archiveLedgerAccount(USER, { accountId: inter.id }, prisma)).rejects.toThrow(/balance of 40 BRL/);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: inter.id } })).archivedAt).toBeNull();

    const forced = await archiveLedgerAccount(USER, { accountId: inter.id, force: true }, prisma);
    expect(forced).toMatchObject({ archived: true, balance: 40, warning: expect.stringContaining("40 BRL") });
    expect(forced.batchId).toBeTruthy();
    await undoBatch(USER, forced.batchId!, prisma);
    expect((await prisma.account.findUniqueOrThrow({ where: { id: inter.id } })).archivedAt).toBeNull();

    await prisma.account.update({ where: { id: inter.id }, data: { initialBalance: 0 } });
    const archived = await archiveLedgerAccount(USER, { accountId: inter.id }, prisma);
    expect(archived).toMatchObject({ archived: true, balance: 0, warning: null });
    const again = await archiveLedgerAccount(USER, { accountId: inter.id }, prisma);
    expect(again.batchId).toBeNull();

    const listed = await listAccounts(USER, prisma);
    const business = listed.businesses.find((row) => row.id === f.pjId);
    expect(business?.accounts.map((account) => account.id)).toEqual([f.pjChecking]);
    expect(business?.accounts[0]).toMatchObject({ id: f.pjChecking, archived: false, isDefault: true });
    const withArchived = await listAccounts(USER, prisma, { includeArchived: true });
    expect(withArchived.businesses.find((row) => row.id === f.pjId)?.accounts).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: inter.id, name: "Inter PJ", archived: true })]),
    );
    expect(listed.personalAccount?.accounts.map((account) => account.id)).toEqual(expect.arrayContaining([f.pfChecking, f.card, f.broker]));

    const ledger = await listLedgerAccounts(USER, {}, prisma);
    expect(ledger.accounts.find((account) => account.id === f.pfChecking)).toMatchObject({ archived: false });
    expect(ledger.accounts.map((account) => account.id)).not.toContain(inter.id);
    expect(ledger.accounts.map((account) => account.id)).not.toContain(f.card);
    const ledgerAll = await listLedgerAccounts(USER, { includeArchived: true }, prisma);
    expect(ledgerAll.accounts.find((account) => account.id === inter.id)).toMatchObject({ archived: true, type: "checking" });

    const booked = await bulkCreateTransactions(
      USER,
      [
        {
          entityType: "business",
          type: "expense",
          amount: 9,
          currency: "BRL",
          description: "Na arquivada",
          category: "Software",
          date: "2026-10-01",
          businessId: f.pjId,
          accountId: inter.id,
        },
      ],
      false,
      prisma,
    );
    expect(booked.created).toEqual([]);
    expect(booked.errors[0].error).toMatch(/archived/);

    await expect(archiveLedgerAccount(USER, { accountId: f.pjChecking, force: true }, prisma)).rejects.toThrow(/main account/);
    await expect(archiveLedgerAccount(OTHER, { accountId: inter.id }, prisma)).rejects.toThrow(/not found/);
  });
});
