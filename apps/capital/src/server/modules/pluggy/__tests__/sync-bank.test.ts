import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import snapshot from "./fixtures/pluggy-snapshot.json";
import { onOrAfter } from "../lib/consent";
import type { PluggyClient, PluggyItemPayload, PluggyTransaction } from "../lib/types";
import { syncPluggy } from "../services/sync";

const NOW = new Date("2026-10-19T15:00:00.000Z");
const USER = "test-user-pluggy-bank-001";

let f: LedgerFixture;
let itemId: string;
let savings: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  const item = await prisma.pluggyItem.create({
    data: { userId: USER, label: "Banco", itemId: "11111111-1111-4111-8111-111111111111", entityKind: "personal", brokerageAccountId: null },
  });
  itemId = item.id;
  savings = (await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Reserva", currency: "BRL" } })).id;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

function fake(opts: { transactions?: PluggyTransaction[]; unfiltered?: boolean }) {
  const fetched: string[] = [];
  let investmentCalls = 0;
  const client: PluggyClient = {
    async getItem() {
      return snapshot.item as PluggyItemPayload;
    },
    async getAccounts() {
      return [];
    },
    async getTransactions(accountId, since) {
      fetched.push(accountId);
      return (opts.transactions ?? []).filter((row) => (opts.unfiltered || onOrAfter(row.date, since)) && (!row.accountId || row.accountId === accountId));
    },
    async getInvestments() {
      investmentCalls += 1;
      return [];
    },
    async getInvestmentTransactions() {
      return [];
    },
  };
  return { client, fetched, investmentCalls: () => investmentCalls };
}

const run = (client: PluggyClient, id = itemId) => syncPluggy(USER, { db: prisma, client, now: NOW, guesser: null, enabled: true }, { trigger: "manual", itemRowId: id });

const link = (pluggyAccountId: string, capitalAccountId: string | null, type = "BANK", item = itemId) =>
  prisma.pluggyAccountLink.create({ data: { itemRowId: item, pluggyAccountId, name: pluggyAccountId, type, capitalAccountId } });

const bank = (id: string, accountId: string, type: "DEBIT" | "CREDIT", amount: number, day: string, description: string | null = "Movimento", extra: Partial<PluggyTransaction> = {}): PluggyTransaction => ({
  id,
  accountId,
  type,
  amount,
  date: `${day}T12:00:00.000Z`,
  description,
  status: "POSTED",
  currencyCode: "BRL",
  ...extra,
});

const reviews = () => prisma.pluggyReview.findMany({ where: { userId: USER, status: "open" }, orderBy: { createdAt: "asc" } });
const entries = () => prisma.ledgerEntry.findMany({ where: { userId: USER, deletedAt: null }, orderBy: [{ date: "asc" }, { description: "asc" }] });
const refs = () => prisma.pluggyExternalRef.findMany({ where: { userId: USER }, orderBy: { pluggyId: "asc" } });

describe("which Pluggy accounts are read", () => {
  it("skips unmapped links, links to an archived account or to the other entity's account, and investment links, counting each", async () => {
    const archived = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", name: "Antiga", currency: "BRL", archivedAt: new Date() } });
    await link("acc-unmapped", null);
    await link("acc-archived", archived.id);
    await link("acc-business", f.pjChecking);
    await link("acc-invest", f.broker, "INVESTMENT");
    await link("acc-ok", f.pfChecking);
    const pluggy = fake({ transactions: [bank("t-ok", "acc-ok", "DEBIT", 10, "2026-10-16", "Padaria")] });

    const report = await run(pluggy.client);

    expect(pluggy.fetched).toEqual(["acc-ok"]);
    // The investment link is not read as a bank account, but it gives the connection its brokerage.
    expect(report.items[0]?.stats).toMatchObject({ unmapped: 3, created: 1 });
    expect((await entries()).map((entry) => [entry.description, entry.accountId])).toEqual([["Padaria", f.pfChecking]]);
    expect(pluggy.investmentCalls()).toBe(1);
  });

  it("does not import a transaction from before the cutoff, even if the client returned it, and skips a pending one", async () => {
    await prisma.pluggyItem.update({ where: { id: itemId }, data: { syncCutoff: new Date("2026-10-12T12:00:00.000Z") } });
    await link("acc-1", f.pfChecking);
    const pluggy = fake({
      unfiltered: true,
      transactions: [
        bank("t-early", "acc-1", "DEBIT", 10, "2026-10-10"),
        bank("t-late", "acc-1", "DEBIT", 20, "2026-10-15"),
        bank("t-pending", "acc-1", "DEBIT", 30, "2026-10-16", "Pendente", { status: "pending" }),
      ],
    });

    const report = await run(pluggy.client);

    expect(report.items[0]?.stats).toMatchObject({ created: 1, skipped: 2 });
    expect((await refs()).map((ref) => ref.pluggyId)).toEqual(["t-late"]);
  });

  it("books a transaction with no description, currency or status as 'Lançamento', and reads the direction in any case", async () => {
    await link("acc-1", f.pfChecking);
    const pluggy = fake({
      transactions: [
        { id: "t-bare", accountId: "acc-1", type: "debit", amount: -12.5, date: "2026-10-15T12:00:00.000Z" },
        { id: "t-null", accountId: "acc-1", type: "credit", amount: 30, date: "2026-10-16T12:00:00.000Z", description: null, currencyCode: null, status: null },
      ],
    });

    await run(pluggy.client);

    const rows = await entries();
    expect(rows.map((row) => [row.description, row.kind, Number(row.amount), row.currency])).toEqual([
      ["Lançamento", "expense", -12.5, "BRL"],
      ["Lançamento", "income", 30, "BRL"],
    ]);
  });

  it("books a card purchase as an expense on the mapped card", async () => {
    await link("acc-card", f.card, "CREDIT");
    await run(fake({ transactions: [bank("t-card", "acc-card", "DEBIT", 99.9, "2026-10-16", "Loja X")] }).client);
    const [row] = await entries();
    expect(row).toMatchObject({ accountId: f.card, kind: "expense", description: "Loja X" });
    expect(Number(row!.amount)).toBeCloseTo(-99.9);
  });

  it("opens a conflict review with the reason when a transfer cannot be booked, and keeps going with the rest", async () => {
    // BRL to USD with no exchange rate on file: the ledger refuses the transfer.
    const usd = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Dólar", currency: "USD" } });
    await link("acc-1", f.pfChecking);
    await link("acc-usd", usd.id);
    const pluggy = fake({
      transactions: [
        bank("t-out", "acc-1", "DEBIT", 80, "2026-10-15", "Câmbio 123456789"),
        bank("t-in", "acc-usd", "CREDIT", 80, "2026-10-15", "Câmbio", { currencyCode: "USD" }),
        bank("t-good", "acc-1", "DEBIT", 7, "2026-10-16", "Normal"),
      ],
    });

    const report = await run(pluggy.client);

    expect(report.items[0]).toMatchObject({ status: "ok", stats: { conflicts: 1, created: 2 } });
    const [review] = await reviews();
    expect(review?.kind).toBe("conflict");
    expect(review?.draft).toMatchObject({ pluggyId: "t-out", description: "Câmbio ••••", amount: -80, date: "2026-10-15" });
    expect((review!.draft as { reason: string }).reason).toMatch(/exchange rate/i);
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
    expect((await refs()).map((ref) => ref.pluggyId)).toEqual(["t-good", "t-in"]);
  });
});

describe("money moving between the user's own accounts", () => {
  async function twoAccounts() {
    await link("acc-1", f.pfChecking);
    await link("acc-2", savings);
  }

  it("books one transfer whichever side Pluggy lists first, and names it from whichever side has a description", async () => {
    // Links are read in the order they were created, so the credit side comes first here.
    await link("acc-2", savings);
    await link("acc-1", f.pfChecking);
    const out = bank("t-out", "acc-1", "DEBIT", 80, "2026-10-16", "");
    const inn = bank("t-in", "acc-2", "CREDIT", 80, "2026-10-17", "PIX recebido", { currencyCode: undefined });

    const report = await run(fake({ transactions: [out, inn] }).client);

    expect(report.items[0]?.stats).toMatchObject({ created: 1, conflicts: 0 });
    const rows = await entries();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "transfer" && row.description === "PIX recebido")).toBe(true);
    expect(rows.find((row) => row.accountId === f.pfChecking)?.amount.toString()).toBe("-80");
    expect(rows.find((row) => row.accountId === savings)?.amount.toString()).toBe("80");
    expect((await refs()).map((ref) => ref.pluggyId)).toEqual(["t-in", "t-out"]);
  });

  it("falls back to a generic description when neither side has one", async () => {
    await twoAccounts();
    await run(fake({ transactions: [bank("t-out", "acc-1", "DEBIT", 80, "2026-10-16", null), bank("t-in", "acc-2", "CREDIT", 80, "2026-10-16", null)] }).client);
    expect((await entries()).map((row) => row.description)).toEqual(["Transferência", "Transferência"]);
  });

  it("does not pair rows that differ by more than a cent, or are more than three days apart", async () => {
    await twoAccounts();
    const report = await run(
      fake({
        transactions: [
          bank("t-a", "acc-1", "DEBIT", 80, "2026-10-10", "A"),
          bank("t-b", "acc-2", "CREDIT", 80.02, "2026-10-10", "B"),
          bank("t-c", "acc-1", "DEBIT", 55, "2026-10-01", "C"),
          bank("t-d", "acc-2", "CREDIT", 55, "2026-10-09", "D"),
        ],
      }).client,
    );
    expect(report.items[0]?.stats).toMatchObject({ created: 4, conflicts: 0 });
    expect((await entries()).map((row) => [row.description, row.kind])).toEqual([["C", "expense"], ["D", "income"], ["A", "expense"], ["B", "income"]]);
  });

  it("opens one review for an ambiguous pair, marks every candidate as handled and does not repeat it next run", async () => {
    await twoAccounts();
    const client = fake({
      transactions: [
        bank("t-out-1", "acc-1", "DEBIT", 80, "2026-10-16", "PIX 1"),
        bank("t-out-2", "acc-1", "DEBIT", 80, "2026-10-16", "PIX 2"),
        bank("t-in", "acc-2", "CREDIT", 80, "2026-10-16", "PIX recebido"),
      ],
    }).client;

    const first = await run(client);
    await run(client);

    expect(first.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
    expect(await entries()).toEqual([]);
    const open = await reviews();
    expect(open).toHaveLength(1);
    expect(open[0]?.draft).toMatchObject({ pluggyId: "t-out-1", reason: "ambiguous", amount: -80 });
    expect((open[0]!.draft as { candidateIds: string[] }).candidateIds.sort()).toEqual(["t-in", "t-out-1", "t-out-2"]);
  });

  it("links a feed row to the matching leg of a transfer the user already entered", async () => {
    await twoAccounts();
    const manual = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: savings, amount: 80, date: "2026-10-16", description: "Reserva" }, prisma);

    const report = await run(fake({ transactions: [bank("t-out", "acc-1", "DEBIT", 80, "2026-10-16", "PIX reserva")] }).client);

    expect(report.items[0]?.stats).toMatchObject({ linked: 1, created: 0, conflicts: 0 });
    expect(await entries()).toHaveLength(2);
    const [ref] = await refs();
    expect(ref).toMatchObject({ pluggyId: "t-out", matchKind: "linked" });
    const checkingLeg = await prisma.ledgerEntry.findFirstOrThrow({ where: { id: { in: manual.entryIds }, accountId: f.pfChecking } });
    expect(ref?.ledgerEntryId).toBe(checkingLeg.id);
  });

  it("asks for a review instead of guessing when the other account already has a plain entry of the same amount", async () => {
    await twoAccounts();
    const plain = await createEntry(USER, { kind: "income", accountId: savings, amount: 80, date: "2026-10-17", description: "Entrada manual" }, prisma);

    const report = await run(fake({ transactions: [bank("t-out", "acc-1", "DEBIT", 80, "2026-10-16", "PIX")] }).client);

    expect(report.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0, linked: 0 });
    expect(await entries()).toHaveLength(1);
    const [review] = await reviews();
    expect(review?.draft).toMatchObject({ pluggyId: "t-out", reason: "ambiguous", candidateIds: [plain.entryIds[0]] });
    expect(await refs()).toEqual([]);
  });

  it("does not look at entries of an archived account the user mapped on another connection", async () => {
    const archived = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Fechada", currency: "BRL" } });
    await createEntry(USER, { kind: "income", accountId: archived.id, amount: 80, date: "2026-10-17", description: "Entrada antiga" }, prisma);
    const otherItem = await prisma.pluggyItem.create({ data: { userId: USER, label: "Outro", itemId: "22222222-2222-4222-8222-222222222222", entityKind: "personal" } });
    await link("acc-closed", archived.id, "BANK", otherItem.id);
    await prisma.account.update({ where: { id: archived.id }, data: { archivedAt: new Date() } });
    await link("acc-1", f.pfChecking);

    const report = await run(fake({ transactions: [bank("t-out", "acc-1", "DEBIT", 80, "2026-10-16", "PIX")] }).client);

    expect(report.items[0]?.stats).toMatchObject({ created: 1, conflicts: 0 });
    expect((await entries()).find((row) => row.description === "PIX")).toMatchObject({ kind: "expense", accountId: f.pfChecking });
  });

  it("does look at entries of an account mapped on another connection", async () => {
    const otherItem = await prisma.pluggyItem.create({ data: { userId: USER, label: "Outro", itemId: "22222222-2222-4222-8222-222222222222", entityKind: "personal" } });
    await link("acc-reserva", savings, "BANK", otherItem.id);
    await createEntry(USER, { kind: "income", accountId: savings, amount: 80, date: "2026-10-17", description: "Entrada manual" }, prisma);
    await link("acc-1", f.pfChecking);

    const report = await run(fake({ transactions: [bank("t-out", "acc-1", "DEBIT", 80, "2026-10-16", "PIX")] }).client);

    expect(report.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
  });
});

describe("caixinha moves and card bill payments", () => {
  it("opens a review when no single brokerage can receive a caixinha deposit", async () => {
    await link("acc-1", f.pfChecking);

    const none = await run(fake({ transactions: [bank("t-none", "acc-1", "DEBIT", 50, "2026-10-16", "Aplicação caixinha")] }).client);
    expect(none.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
    expect((await reviews())[0]?.draft).toMatchObject({ pluggyId: "t-none", reason: "ambiguous", amount: -50 });
    expect(await entries()).toEqual([]);

    // Two brokerages mapped: still no single counterparty.
    await prisma.pluggyReview.deleteMany({ where: { userId: USER } });
    const second = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "brokerage", name: "Rico", currency: "BRL" } });
    await prisma.pluggyItem.update({ where: { id: itemId }, data: { brokerageAccountId: f.broker } });
    await link("acc-rico", second.id, "INVESTMENT");
    const two = await run(fake({ transactions: [bank("t-two", "acc-1", "DEBIT", 50, "2026-10-17", "Aplicação caixinha")] }).client);
    expect(two.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
    expect(await entries()).toEqual([]);
  });

  it("books a caixinha withdrawal as a transfer from the brokerage into the checking account, with one reference", async () => {
    await prisma.pluggyItem.update({ where: { id: itemId }, data: { brokerageAccountId: f.broker } });
    await link("acc-1", f.pfChecking);

    const report = await run(fake({ transactions: [bank("t-resgate", "acc-1", "CREDIT", 120, "2026-10-16", "Resgate caixinha")] }).client);

    expect(report.items[0]?.stats).toMatchObject({ created: 1, conflicts: 0 });
    const rows = await entries();
    expect(rows).toHaveLength(2);
    expect(rows.every((row) => row.kind === "transfer")).toBe(true);
    expect(rows.find((row) => row.accountId === f.broker)?.amount.toString()).toBe("-120");
    expect(rows.find((row) => row.accountId === f.pfChecking)?.amount.toString()).toBe("120");
    expect((await prisma.transferGroup.findFirstOrThrow({ where: { userId: USER } })).direction).toBe("investment_withdrawal");
    const [ref] = await refs();
    expect(ref).toMatchObject({ pluggyId: "t-resgate", matchKind: "created" });
    expect(rows.find((row) => row.id === ref!.ledgerEntryId)?.accountId).toBe(f.pfChecking);
  });

  it("books a caixinha move seen from the brokerage side against the one cash account", async () => {
    await prisma.pluggyItem.update({ where: { id: itemId }, data: { brokerageAccountId: f.broker } });
    await link("acc-broker", f.broker);
    await link("acc-1", f.pfChecking);

    const report = await run(fake({ transactions: [bank("t-b", "acc-broker", "CREDIT", 40, "2026-10-16", "Resgate caixinha")] }).client);

    expect(report.items[0]?.stats).toMatchObject({ created: 1, conflicts: 0 });
    const rows = await entries();
    expect(rows.find((row) => row.accountId === f.broker)?.amount.toString()).toBe("40");
    expect(rows.find((row) => row.accountId === f.pfChecking)?.amount.toString()).toBe("-40");
  });

  it("opens a review for a caixinha move from the brokerage when there are two cash accounts to choose from", async () => {
    await prisma.pluggyItem.update({ where: { id: itemId }, data: { brokerageAccountId: f.broker } });
    await link("acc-broker", f.broker);
    await link("acc-1", f.pfChecking);
    await link("acc-2", savings);

    const report = await run(fake({ transactions: [bank("t-b", "acc-broker", "CREDIT", 40, "2026-10-16", "Resgate caixinha")] }).client);

    expect(report.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
    expect(await entries()).toEqual([]);
  });

  it("opens a review for a card bill payment when there is no card, or more than one, to receive it", async () => {
    await link("acc-1", f.pfChecking);
    const none = await run(fake({ transactions: [bank("t-fatura-1", "acc-1", "DEBIT", 300, "2026-10-16", "Pagamento de fatura")] }).client);
    expect(none.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });

    await prisma.pluggyReview.deleteMany({ where: { userId: USER } });
    const second = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Outro cartão", currency: "BRL", closingDay: 10, dueDay: 20 } });
    await link("acc-card-1", f.card, "CREDIT");
    await link("acc-card-2", second.id, "CREDIT");
    const many = await run(fake({ transactions: [bank("t-fatura-2", "acc-1", "DEBIT", 300, "2026-10-17", "Pagamento de fatura")] }).client);
    expect(many.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
    expect((await reviews())[0]?.draft).toMatchObject({ pluggyId: "t-fatura-2", reason: "ambiguous" });
    expect(await entries()).toEqual([]);
  });

  it("ignores a bill-payment description on a credit-side row and on a card account", async () => {
    await link("acc-card", f.card, "CREDIT");
    await link("acc-1", f.pfChecking);
    const report = await run(
      fake({
        transactions: [
          bank("t-credit", "acc-1", "CREDIT", 10, "2026-10-16", "Pagamento de fatura estornado"),
          bank("t-card-debit", "acc-card", "DEBIT", 20, "2026-10-16", "Fatura parcelada"),
        ],
      }).client,
    );
    expect(report.items[0]?.stats).toMatchObject({ created: 2, conflicts: 0 });
    expect((await entries()).map((row) => row.kind).sort()).toEqual(["expense", "income"]);
  });
});

describe("credits on a card", () => {
  it("links a refund to the one matching entry on the card, and asks for a review when several match", async () => {
    await link("acc-card", f.card, "CREDIT");
    const refund = await createEntry(USER, { kind: "income", accountId: f.card, amount: 15, date: "2026-10-16", description: "Estorno manual" }, prisma);

    const one = await run(fake({ transactions: [bank("t-refund", "acc-card", "CREDIT", 15, "2026-10-16", "Estorno")] }).client);
    expect(one.items[0]?.stats).toMatchObject({ linked: 1, conflicts: 0, created: 0 });
    expect((await refs())[0]).toMatchObject({ pluggyId: "t-refund", matchKind: "linked", ledgerEntryId: refund.entryIds[0] });

    await createEntry(USER, { kind: "income", accountId: f.card, amount: 22, date: "2026-10-16", description: "Crédito A" }, prisma);
    await createEntry(USER, { kind: "income", accountId: f.card, amount: 22, date: "2026-10-17", description: "Crédito B" }, prisma);
    const many = await run(fake({ transactions: [bank("t-refund-2", "acc-card", "CREDIT", 22, "2026-10-16", "Estorno 2")] }).client);
    expect(many.items[0]?.stats).toMatchObject({ conflicts: 1 });
    const [review] = await reviews();
    expect(review?.draft).toMatchObject({ pluggyId: "t-refund-2", reason: "multiple_matches" });
    expect((review!.draft as { candidateIds: string[] }).candidateIds).toHaveLength(2);
    expect(await entries()).toHaveLength(3);
  });
});

describe("edge cases of pairing and description rules", () => {
  it("never pairs a zero-amount row, and ignores a zero-amount entry already on the other account", async () => {
    await link("acc-1", f.pfChecking);
    await link("acc-2", savings);
    await createEntry(USER, { kind: "income", accountId: savings, amount: 0, date: "2026-10-16", description: "Zerado manual" }, prisma);

    const report = await run(
      fake({
        transactions: [
          bank("t-zero", "acc-1", "CREDIT", 0, "2026-10-16", "Tarifa isenta"),
          bank("t-real", "acc-1", "DEBIT", 33, "2026-10-16", "Padaria"),
        ],
      }).client,
    );

    expect(report.items[0]?.stats).toMatchObject({ created: 2, conflicts: 0, linked: 0 });
    expect((await refs()).map((ref) => ref.pluggyId)).toEqual(["t-real", "t-zero"]);
    expect(await prisma.transferGroup.count({ where: { userId: USER } })).toBe(0);
  });

  it("asks for a review when one debit has two possible credits on different accounts, and marks both as handled", async () => {
    const reserve = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Reserva 2", currency: "BRL" } });
    await link("acc-1", f.pfChecking);
    await link("acc-2", savings);
    await link("acc-3", reserve.id);

    const report = await run(
      fake({
        transactions: [
          bank("t-out", "acc-1", "DEBIT", 80, "2026-10-16", "PIX"),
          bank("t-in-a", "acc-2", "CREDIT", 80, "2026-10-16", "PIX A"),
          bank("t-in-b", "acc-3", "CREDIT", 80, "2026-10-16", "PIX B"),
        ],
      }).client,
    );

    expect(report.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
    expect(await entries()).toEqual([]);
    const [review] = await reviews();
    expect((review!.draft as { candidateIds: string[] }).candidateIds.sort()).toEqual(["t-in-a", "t-in-b"]);
  });

  it("books a card bill payment seen only on the checking side as a transfer into the one mapped card", async () => {
    await link("acc-1", f.pfChecking);
    await link("acc-card", f.card, "CREDIT");

    const report = await run(fake({ transactions: [bank("t-fatura", "acc-1", "DEBIT", 450, "2026-10-16", "Pagamento de fatura")] }).client);

    expect(report.items[0]?.stats).toMatchObject({ created: 1, conflicts: 0 });
    expect((await prisma.transferGroup.findFirstOrThrow({ where: { userId: USER } })).direction).toBe("card_payment");
    const rows = await entries();
    expect(rows.find((row) => row.accountId === f.pfChecking)?.amount.toString()).toBe("-450");
    expect(rows.find((row) => row.accountId === f.card)?.amount.toString()).toBe("450");
    expect(await refs()).toHaveLength(1);
  });

  it("opens a review instead of an expense when a card purchase's description reads like a caixinha move", async () => {
    await link("acc-card", f.card, "CREDIT");
    const report = await run(fake({ transactions: [bank("t-app", "acc-card", "DEBIT", 20, "2026-10-16", "Aplicação de teste")] }).client);
    expect(report.items[0]?.stats).toMatchObject({ conflicts: 1, created: 0 });
    expect((await reviews())[0]?.draft).toMatchObject({ pluggyId: "t-app", reason: "ambiguous" });
    expect(await entries()).toEqual([]);
  });
});
