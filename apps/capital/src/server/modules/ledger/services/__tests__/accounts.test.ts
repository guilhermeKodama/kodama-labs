import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import {
  accountBalances,
  createAccount,
  getOwnedAccount,
  listAccounts,
  serializeAccount,
  setAccountBalance,
  updateAccount,
} from "../accounts";
import { createEntry, softDeleteEntries } from "../entries";
import { undoBatch, type MutationRecordInput } from "../mutations";

const USER = "test-user-ledger-accounts-001";
const OTHER = "test-user-ledger-accounts-002";
let f: LedgerFixture;
let o: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  o = await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const card = (overrides: Partial<Parameters<typeof createAccount>[1]> = {}) => ({
  entityId: f.pfId,
  type: "credit_card" as const,
  name: "Itau",
  creditLimit: 5000,
  closingDay: 10,
  dueDay: 17,
  ...overrides,
});

describe("getOwnedAccount", () => {
  it("returns the user's account and 404s on someone else's", async () => {
    expect((await getOwnedAccount(USER, f.pfChecking, prisma)).id).toBe(f.pfChecking);
    await expect(getOwnedAccount(USER, o.pfChecking, prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
  });
});

describe("createAccount", () => {
  it("creates a checking account in the entity's currency with the input defaults", async () => {
    const a = await createAccount(USER, { entityId: f.pjId, type: "checking", name: "Inter" }, prisma);
    expect(a).toMatchObject({ userId: USER, entityId: f.pjId, type: "checking", name: "Inter", currency: "BRL", institution: null, externalId: null, color: null, isDefault: false });
    expect(Number(a.initialBalance)).toBe(0);
    expect(a.creditLimit).toBeNull();
    expect(a.payFromAccountId).toBeNull();
  });

  it("stores every optional field it is given, and drops the card fields on other account types", async () => {
    const a = await createAccount(
      USER,
      {
        entityId: f.pfId,
        type: "brokerage",
        name: "Avenue",
        institution: "Avenue",
        currency: "USD",
        externalId: "ext-1",
        initialBalance: 1500.25,
        color: "#00ff00",
        creditLimit: 9999,
        closingDay: 3,
        dueDay: 4,
        payFromAccountId: f.pfChecking,
      },
      prisma
    );
    expect(a).toMatchObject({ institution: "Avenue", currency: "USD", externalId: "ext-1", color: "#00ff00", closingDay: null, dueDay: null, creditLimit: null, payFromAccountId: f.pfChecking });
    expect(Number(a.initialBalance)).toBe(1500.25);
  });

  it("creates a credit card with its limit and billing days", async () => {
    const a = await createAccount(USER, card({ payFromAccountId: f.pfChecking }), prisma);
    expect(a).toMatchObject({ type: "credit_card", closingDay: 10, dueDay: 17, payFromAccountId: f.pfChecking });
    expect(Number(a.creditLimit)).toBe(5000);
  });

  it.each([
    ["a missing closing day", { closingDay: null }, "closingDay"],
    ["a closing day of 0", { closingDay: 0 }, "closingDay"],
    ["a closing day over 31", { closingDay: 32 }, "closingDay"],
    ["a fractional closing day", { closingDay: 5.5 }, "closingDay"],
    ["a missing due day", { dueDay: undefined }, "dueDay"],
  ])("refuses a card with %s", async (_label, overrides, field) => {
    await expect(createAccount(USER, card(overrides), prisma)).rejects.toMatchObject({ status: 422, code: "account.invalid_day", params: { field } });
  });

  it("refuses a card without a positive credit limit", async () => {
    await expect(createAccount(USER, card({ creditLimit: 0 }), prisma)).rejects.toMatchObject({ status: 422, code: "account.invalid_credit_limit" });
    await expect(createAccount(USER, card({ creditLimit: null }), prisma)).rejects.toMatchObject({ status: 422, code: "account.invalid_credit_limit" });
  });

  it("refuses an entity or a pay-from account that is not the user's, and writes nothing", async () => {
    const before = await prisma.account.count({ where: { userId: USER } });
    await expect(createAccount(USER, { entityId: o.pfId, type: "checking", name: "X" }, prisma)).rejects.toMatchObject({ status: 404, code: "entity.not_found" });
    await expect(createAccount(USER, card({ payFromAccountId: o.pfChecking }), prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
    expect(await prisma.account.count({ where: { userId: USER } })).toBe(before);
  });
});

describe("updateAccount", () => {
  it("edits the fields in the patch as one undoable batch and keeps the rest", async () => {
    const r = await updateAccount(
      USER,
      f.broker,
      { name: "XP Investimentos", institution: "XP", externalId: "x1", color: "#112233", initialBalance: 10 },
      prisma
    );
    expect(r).toMatchObject({ name: "XP Investimentos", institution: "XP", externalId: "x1", color: "#112233", currency: "BRL" });
    expect(Number(r.initialBalance)).toBe(10);
    expect(r.batchId).not.toBeNull();
    await undoBatch(USER, r.batchId!, prisma);
    expect(await prisma.account.findUniqueOrThrow({ where: { id: f.broker } })).toMatchObject({ name: "XP", institution: null, color: null });
  });

  it("validates a card against the patch merged with what it already has", async () => {
    const r = await updateAccount(USER, f.card, { creditLimit: 20000, closingDay: 20, dueDay: 28, payFromAccountId: null }, prisma);
    expect(r).toMatchObject({ closingDay: 20, dueDay: 28, payFromAccountId: null });
    expect(Number(r.creditLimit)).toBe(20000);
    await expect(updateAccount(USER, f.card, { closingDay: 40 }, prisma)).rejects.toMatchObject({ status: 422, code: "account.invalid_day" });
    await expect(updateAccount(USER, f.card, { creditLimit: -1 }, prisma)).rejects.toMatchObject({ status: 422, code: "account.invalid_credit_limit" });
    expect((await prisma.account.findUniqueOrThrow({ where: { id: f.card } })).closingDay).toBe(20);
  });

  it("points a card at another of the user's accounts to pay from, and refuses a stranger's", async () => {
    const r = await updateAccount(USER, f.card, { payFromAccountId: f.pjChecking }, prisma);
    expect(r.payFromAccountId).toBe(f.pjChecking);
    await expect(updateAccount(USER, f.card, { payFromAccountId: o.pfChecking }, prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
  });

  it("archives (keeping the first date) and unarchives", async () => {
    const first = await updateAccount(USER, f.broker, { archived: true }, prisma);
    expect(first.archivedAt).toBeInstanceOf(Date);
    const again = await updateAccount(USER, f.broker, { archived: true }, prisma);
    expect(again.archivedAt!.getTime()).toBe(first.archivedAt!.getTime());
    const back = await updateAccount(USER, f.broker, { archived: false }, prisma);
    expect(back.archivedAt).toBeNull();
  });

  it("changes the currency (upper-cased) of an account without entries, but not of one with entries", async () => {
    const changed = await updateAccount(USER, f.broker, { currency: "usd" }, prisma);
    expect(changed.currency).toBe("USD");
    expect(changed.batchId).toBeNull(); // not undoable

    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, date: "2026-09-10", description: "Cafe" }, prisma);
    await expect(updateAccount(USER, f.pfChecking, { currency: "USD" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "account.currency_locked",
      params: { count: 1, currency: "BRL" },
    });
    // The same currency in another case is not a change.
    const same = await updateAccount(USER, f.pfChecking, { currency: "brl", name: "Principal" }, prisma);
    expect(same.name).toBe("Principal");
    expect(same.batchId).not.toBeNull();
  });

  it("counts trashed entries towards the currency lock", async () => {
    const e = await createEntry(USER, { kind: "expense", accountId: f.broker, amount: 5, date: "2026-09-10", description: "Taxa" }, prisma);
    await softDeleteEntries(USER, e.entryIds, prisma);
    await expect(updateAccount(USER, f.broker, { currency: "USD" }, prisma)).rejects.toMatchObject({ code: "account.currency_locked" });
  });

  it("moves an empty account to another entity, unrecorded, and refuses the unmovable cases", async () => {
    const moved = await updateAccount(USER, f.broker, { entityId: f.pjId }, prisma);
    expect(moved.entityId).toBe(f.pjId);
    expect(moved.batchId).toBeNull();

    await expect(updateAccount(USER, f.pfChecking, { entityId: f.pjId }, prisma)).rejects.toMatchObject({ status: 422, code: "account.default_entity_locked" });
    await expect(updateAccount(USER, f.card, { entityId: o.pjId }, prisma)).rejects.toMatchObject({ status: 404, code: "entity.not_found" });

    const archivedEntity = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Velha", archivedAt: new Date() } });
    await expect(updateAccount(USER, f.card, { entityId: archivedEntity.id }, prisma)).rejects.toMatchObject({ status: 422, code: "entity.archived", params: { name: "Velha" } });
  });

  it("refuses to move an account that has entries or recurring rules", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.card, amount: 5, date: "2026-09-10", description: "Cafe" }, prisma);
    await expect(updateAccount(USER, f.card, { entityId: f.pjId }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "account.entity_locked",
      params: { entries: 1, recurring: 0 },
    });
    await prisma.recurringRule.create({
      data: { userId: USER, entityId: f.pfId, accountId: f.broker, kind: "expense", amount: 10, currency: "BRL", description: "Taxa", frequency: "monthly", startDate: new Date("2026-09-01T12:00:00Z"), nextDueDate: new Date("2026-09-01T12:00:00Z") },
    });
    await expect(updateAccount(USER, f.broker, { entityId: f.pjId }, prisma)).rejects.toMatchObject({ code: "account.entity_locked", params: { entries: 0, recurring: 1 } });
  });

  it("sets the balance by moving the opening balance by the difference", async () => {
    await createEntry(USER, { kind: "income", accountId: f.broker, amount: 100, date: "2026-09-10", description: "Aporte" }, prisma);
    const r = await updateAccount(USER, f.broker, { balance: 350.5 }, prisma);
    expect(Number(r.initialBalance)).toBe(250.5);
    expect((await accountBalances(USER, prisma, [f.broker])).get(f.broker)).toBe(350.5);
  });

  it("collects the record into the caller's batch, or records nothing when asked not to", async () => {
    const collect: MutationRecordInput[] = [];
    const collected = await updateAccount(USER, f.broker, { name: "A" }, prisma, { collect });
    expect(collected.batchId).toBeNull();
    expect(collect).toHaveLength(1);
    expect(collect[0]).toMatchObject({ model: "Account", recordId: f.broker });

    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });
    const silent = await updateAccount(USER, f.broker, { name: "B" }, prisma, { record: false });
    expect(silent.batchId).toBeNull();
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);

    // A currency change is not undoable, so it is not collected either.
    const none: MutationRecordInput[] = [];
    await updateAccount(USER, f.broker, { currency: "EUR" }, prisma, { collect: none });
    expect(none).toHaveLength(0);
  });

  it("404s on someone else's account", async () => {
    await expect(updateAccount(USER, o.broker, { name: "X" }, prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
  });
});

describe("setAccountBalance", () => {
  it("moves the opening balance so the balance matches, in one batch that undo reverts", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 30, date: "2026-09-10", description: "Mercado" }, prisma);
    const r = await setAccountBalance(USER, f.pfChecking, 500, prisma);
    expect(r.account.balance).toBe(500);
    expect(Number(r.account.initialBalance)).toBe(530);
    expect(r.batchId).not.toBeNull();
    await undoBatch(USER, r.batchId!, prisma);
    expect((await accountBalances(USER, prisma, [f.pfChecking])).get(f.pfChecking)).toBe(-30);
  });

  it("writes nothing when the balance already matches", async () => {
    const batches = await prisma.mutationBatch.count({ where: { userId: USER } });
    const r = await setAccountBalance(USER, f.pfChecking, 0, prisma);
    expect(r.batchId).toBeNull();
    expect(r.account.balance).toBe(0);
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(batches);
  });

  it("404s on someone else's account", async () => {
    await expect(setAccountBalance(USER, o.pfChecking, 1, prisma)).rejects.toMatchObject({ status: 404, code: "account.not_found" });
  });
});

describe("accountBalances and listAccounts", () => {
  it("sums the live entries on the opening balance, optionally up to a date", async () => {
    await prisma.account.update({ where: { id: f.pfChecking }, data: { initialBalance: 100 } });
    await createEntry(USER, { kind: "income", accountId: f.pfChecking, amount: 50, date: "2026-09-01", description: "Venda" }, prisma);
    const later = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 20, date: "2026-09-20", description: "Luz" }, prisma);
    const trashed = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 1000, date: "2026-09-21", description: "Apagada" }, prisma);
    await softDeleteEntries(USER, trashed.entryIds, prisma);

    expect((await accountBalances(USER, prisma, [f.pfChecking])).get(f.pfChecking)).toBe(130);
    expect((await accountBalances(USER, prisma, [f.pfChecking], new Date("2026-09-10T00:00:00Z"))).get(f.pfChecking)).toBe(150);
    expect(later.entryIds).toHaveLength(1);
    // Without ids it answers for every account of the user, and only theirs.
    const all = await accountBalances(USER, prisma);
    expect(all.size).toBe(4);
    expect(all.has(o.pfChecking)).toBe(false);
  });

  it("lists active accounts by default with balances, filtered by type and entity, archived on request", async () => {
    await createEntry(USER, { kind: "income", accountId: f.broker, amount: 10, date: "2026-09-01", description: "Dividendo" }, prisma);
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });
    const active = await listAccounts(USER, prisma);
    expect(active.map((a) => a.id)).not.toContain(f.broker);
    const withArchived = await listAccounts(USER, prisma, { includeArchived: true });
    expect(withArchived.find((a) => a.id === f.broker)?.balance).toBe(10);
    expect((await listAccounts(USER, prisma, { type: "credit_card" })).map((a) => a.id)).toEqual([f.card]);
    expect((await listAccounts(USER, prisma, { entityId: f.pjId })).map((a) => a.id)).toEqual([f.pjChecking]);
    // The default account of an entity comes first.
    expect((await listAccounts(USER, prisma, { entityId: f.pfId }))[0].id).toBe(f.pfChecking);
  });
});

describe("serializeAccount", () => {
  it("renders decimals as numbers and dates as ISO strings", async () => {
    const row = await prisma.account.findUniqueOrThrow({ where: { id: f.card } });
    expect(serializeAccount({ ...row, balance: -12.5 })).toMatchObject({
      id: f.card,
      type: "credit_card",
      creditLimit: 10000,
      initialBalance: 0,
      balance: -12.5,
      closingDay: 5,
      dueDay: 12,
      payFromAccountId: f.pfChecking,
      archivedAt: null,
      createdAt: row.createdAt.toISOString(),
    });
    const archived = serializeAccount({ ...row, archivedAt: new Date("2026-09-01T00:00:00Z"), creditLimit: null });
    expect(archived).toMatchObject({ balance: null, creditLimit: null, archivedAt: "2026-09-01T00:00:00.000Z" });
  });
});
