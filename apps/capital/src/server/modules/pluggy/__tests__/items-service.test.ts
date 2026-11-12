import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createHolding } from "@capital/server/modules/investments/services/portfolio";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";

const configured = vi.hoisted(() => ({ value: true }));
vi.mock("../lib/config", () => ({ isPluggyConfigured: () => configured.value }));

import {
  assertItemId,
  createPluggyItem,
  deletePluggyItem,
  mapPluggyAccount,
  pluggyOverview,
  resolvePluggyReview,
  updatePluggyItem,
} from "../services/items";

const USER = "test-user-pluggy-items-001";
const OTHER = "test-user-pluggy-items-002";
const ITEM_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";
const MISSING = "00000000-0000-0000-0000-000000000000";

let f: LedgerFixture;
let other: LedgerFixture;

beforeEach(async () => {
  configured.value = true;
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const newItem = (data: Partial<{ userId: string; entityKind: "personal" | "business"; itemId: string }> = {}) =>
  prisma.pluggyItem.create({
    data: { userId: data.userId ?? USER, label: "Nubank", itemId: data.itemId ?? ITEM_UUID, entityKind: data.entityKind ?? "personal" },
  });

const expectLedgerError = async (promise: Promise<unknown>, status: number, code: string) => {
  const error = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(LedgerError);
  expect(error).toMatchObject({ status, code });
};

describe("assertItemId", () => {
  it("accepts a UUID in any case and returns it trimmed", () => {
    expect(assertItemId(`  ${ITEM_UUID.toUpperCase()}\n`)).toBe(ITEM_UUID.toUpperCase());
  });

  it("rejects anything that is not a UUID with 422 pluggy.item_id", () => {
    for (const bad of ["", "not-a-uuid", `${ITEM_UUID}0`, "1111111-1111-4111-8111-111111111111"]) {
      expect(() => assertItemId(bad)).toThrowError(expect.objectContaining({ status: 422, code: "pluggy.item_id" }));
    }
  });
});

describe("pluggyOverview", () => {
  it("is empty for a user with no connections and reports whether the integration is configured", async () => {
    expect(await pluggyOverview(USER, prisma)).toEqual({ enabled: true, items: [], reviews: [] });
    configured.value = false;
    expect((await pluggyOverview(USER, prisma)).enabled).toBe(false);
  });

  it("lists the user's connections oldest first with ISO dates, sorted accounts and only open reviews", async () => {
    const first = await newItem();
    const second = await prisma.pluggyItem.create({
      data: {
        userId: USER,
        label: "XP",
        itemId: OTHER_UUID,
        entityKind: "business",
        status: "error",
        lastError: "boom",
        consentExpiresAt: new Date("2027-01-02T03:04:05.000Z"),
        lastSyncAt: new Date("2026-10-01T10:00:00.000Z"),
        lastSuccessAt: new Date("2026-09-30T10:00:00.000Z"),
        syncingAt: new Date(),
        syncCutoff: new Date("2026-08-15T12:00:00.000Z"),
        incomeCategoryId: null,
        brokerageAccountId: f.broker,
        createdAt: new Date(Date.now() + 1000),
      },
    });
    await prisma.pluggyAccountLink.createMany({
      data: [
        { itemRowId: second.id, pluggyAccountId: "acc-z", name: "Zeta", type: "BANK", subtype: "SAVINGS_ACCOUNT", capitalAccountId: f.pfChecking },
        { itemRowId: second.id, pluggyAccountId: "acc-a", name: "Alfa", type: "CREDIT" },
      ],
    });
    await newItem({ userId: OTHER, itemId: "33333333-3333-4333-8333-333333333333" });
    await prisma.pluggyReview.create({ data: { userId: USER, itemRowId: first.id, kind: "conflict", draft: { n: 1 }, createdAt: new Date("2026-10-01T00:00:00.000Z") } });
    await prisma.pluggyReview.create({ data: { userId: USER, itemRowId: first.id, kind: "conflict", draft: { n: 2 }, createdAt: new Date("2026-10-02T00:00:00.000Z") } });
    await prisma.pluggyReview.create({ data: { userId: USER, itemRowId: first.id, kind: "conflict", status: "resolved", draft: { n: 3 } } });
    await prisma.pluggyReview.create({ data: { userId: OTHER, kind: "conflict", draft: { n: 4 } } });

    const overview = await pluggyOverview(USER, prisma);

    expect(overview.items.map((item) => item.label)).toEqual(["Nubank", "XP"]);
    expect(overview.items[0]).toMatchObject({
      id: first.id,
      itemId: ITEM_UUID,
      entityKind: "personal",
      status: "idle",
      consentExpiresAt: null,
      lastSyncAt: null,
      lastSuccessAt: null,
      lastError: null,
      syncing: false,
      accounts: [],
    });
    expect(overview.items[0]!.syncCutoff).toBeNull();
    expect(overview.items[1]).toMatchObject({
      status: "error",
      lastError: "boom",
      consentExpiresAt: "2027-01-02T03:04:05.000Z",
      lastSyncAt: "2026-10-01T10:00:00.000Z",
      lastSuccessAt: "2026-09-30T10:00:00.000Z",
      syncing: true,
      syncCutoff: "2026-08-15",
      brokerageAccountId: f.broker,
    });
    expect(overview.items[1]!.accounts.map((account) => [account.name, account.type, account.subtype, account.capitalAccountId])).toEqual([
      ["Alfa", "CREDIT", null, null],
      ["Zeta", "BANK", "SAVINGS_ACCOUNT", f.pfChecking],
    ]);
    expect(overview.reviews.map((review) => review.draft)).toEqual([{ n: 2 }, { n: 1 }]);
    expect(overview.reviews[0]).toMatchObject({ itemRowId: first.id, kind: "conflict", status: "open", createdAt: "2026-10-02T00:00:00.000Z" });
  });
});

describe("createPluggyItem", () => {
  it("saves the connection with a trimmed label and a cutoff on today's date", async () => {
    const created = await createPluggyItem(USER, { label: "  Meu banco  ", itemId: ` ${ITEM_UUID} `, entityKind: "business" }, prisma);
    expect(created).toMatchObject({ userId: USER, label: "Meu banco", itemId: ITEM_UUID, entityKind: "business", status: "idle" });
    expect(created.syncCutoff?.toISOString()).toBe(`${new Date().toISOString().slice(0, 10)}T12:00:00.000Z`);
    expect(await prisma.pluggyItem.count({ where: { userId: USER } })).toBe(1);
  });

  it("rejects a bad item id and a blank label without writing", async () => {
    await expectLedgerError(createPluggyItem(USER, { label: "x", itemId: "nope", entityKind: "personal" }, prisma), 422, "pluggy.item_id");
    await expectLedgerError(createPluggyItem(USER, { label: "   ", itemId: ITEM_UUID, entityKind: "personal" }, prisma), 422, "pluggy.label");
    expect(await prisma.pluggyItem.count({ where: { userId: USER } })).toBe(0);
  });
});

describe("updatePluggyItem", () => {
  it("answers 404 for a missing connection and for another user's", async () => {
    const foreign = await newItem({ userId: OTHER });
    await expectLedgerError(updatePluggyItem(USER, MISSING, { label: "x" }, prisma), 404, "pluggy.not_found");
    await expectLedgerError(updatePluggyItem(USER, foreign.id, { label: "x" }, prisma), 404, "pluggy.not_found");
    expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: foreign.id } })).label).toBe("Nubank");
  });

  it("renames with a trimmed label and refuses a blank one", async () => {
    const item = await newItem();
    expect((await updatePluggyItem(USER, item.id, { label: "  Novo nome " }, prisma)).label).toBe("Novo nome");
    await expectLedgerError(updatePluggyItem(USER, item.id, { label: "  " }, prisma), 422, "pluggy.label");
    expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } })).label).toBe("Novo nome");
  });

  it("resets the status and error when the item id changes, and leaves them when it does not", async () => {
    const item = await prisma.pluggyItem.create({
      data: { userId: USER, label: "Nubank", itemId: ITEM_UUID, entityKind: "personal", status: "expired", lastError: "consent gone" },
    });
    const same = await updatePluggyItem(USER, item.id, { itemId: ITEM_UUID }, prisma);
    expect(same).toMatchObject({ status: "expired", lastError: "consent gone", itemId: ITEM_UUID });
    const renewed = await updatePluggyItem(USER, item.id, { itemId: OTHER_UUID }, prisma);
    expect(renewed).toMatchObject({ status: "idle", lastError: null, itemId: OTHER_UUID });
    await expectLedgerError(updatePluggyItem(USER, item.id, { itemId: "bad" }, prisma), 422, "pluggy.item_id");
  });

  it("switching the entity clears the brokerage, the income category and every account mapping", async () => {
    const category = await prisma.category.create({ data: { userId: USER, name: "Renda", type: "income" } });
    const item = await prisma.pluggyItem.create({
      data: { userId: USER, label: "Nubank", itemId: ITEM_UUID, entityKind: "personal", brokerageAccountId: f.broker, incomeCategoryId: category.id },
    });
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-1", name: "Conta", type: "BANK", capitalAccountId: f.pfChecking } });

    const updated = await updatePluggyItem(USER, item.id, { entityKind: "business" }, prisma);

    expect(updated).toMatchObject({ entityKind: "business", brokerageAccountId: null, incomeCategoryId: null });
    expect((await prisma.pluggyAccountLink.findFirstOrThrow({ where: { itemRowId: item.id } })).capitalAccountId).toBeNull();
  });

  it("does not touch the mappings when the entity is sent unchanged", async () => {
    const item = await newItem();
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-1", name: "Conta", type: "BANK", capitalAccountId: f.pfChecking } });
    await updatePluggyItem(USER, item.id, { entityKind: "personal" }, prisma);
    expect((await prisma.pluggyAccountLink.findFirstOrThrow({ where: { itemRowId: item.id } })).capitalAccountId).toBe(f.pfChecking);
  });

  it("sets the brokerage of the connection's entity, and validates it against the new entity when both change", async () => {
    const item = await newItem();
    expect((await updatePluggyItem(USER, item.id, { brokerageAccountId: f.broker }, prisma)).brokerageAccountId).toBe(f.broker);
    expect((await updatePluggyItem(USER, item.id, { brokerageAccountId: null }, prisma)).brokerageAccountId).toBeNull();

    const pjBroker = await prisma.account.create({ data: { userId: USER, entityId: f.pjId, type: "brokerage", name: "Inter", currency: "BRL" } });
    await expectLedgerError(updatePluggyItem(USER, item.id, { brokerageAccountId: pjBroker.id }, prisma), 422, "pluggy.entity_mismatch");
    const both = await updatePluggyItem(USER, item.id, { entityKind: "business", brokerageAccountId: pjBroker.id }, prisma);
    expect(both).toMatchObject({ entityKind: "business", brokerageAccountId: pjBroker.id });
  });

  it("refuses a brokerage that is not a brokerage account, is archived, or belongs to someone else", async () => {
    const item = await newItem();
    await expectLedgerError(updatePluggyItem(USER, item.id, { brokerageAccountId: f.pfChecking }, prisma), 422, "pluggy.account_type");
    await expectLedgerError(updatePluggyItem(USER, item.id, { brokerageAccountId: MISSING }, prisma), 404, "account.not_found");
    await expectLedgerError(updatePluggyItem(USER, item.id, { brokerageAccountId: other.broker }, prisma), 404, "account.not_found");
    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });
    await expectLedgerError(updatePluggyItem(USER, item.id, { brokerageAccountId: f.broker }, prisma), 404, "account.not_found");
    expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } })).brokerageAccountId).toBeNull();
  });

  it("stores the cutoff as a date, or clears it", async () => {
    const item = await newItem();
    const dated = await updatePluggyItem(USER, item.id, { syncCutoff: "2026-05-04" }, prisma);
    expect(dated.syncCutoff?.toISOString()).toBe("2026-05-04T12:00:00.000Z");
    expect((await updatePluggyItem(USER, item.id, { syncCutoff: null }, prisma)).syncCutoff).toBeNull();
  });

  it("sets an active income category, clears it, and refuses an expense, an archived or a foreign one", async () => {
    const item = await newItem();
    const income = await prisma.category.create({ data: { userId: USER, name: "Renda financeira", type: "income" } });
    const expense = await prisma.category.create({ data: { userId: USER, name: "Mercado extra", type: "expense" } });
    const archived = await prisma.category.create({ data: { userId: USER, name: "Antiga", type: "income", isArchived: true } });
    const foreign = await prisma.category.create({ data: { userId: OTHER, name: "Renda alheia", type: "income" } });

    expect((await updatePluggyItem(USER, item.id, { incomeCategoryId: income.id }, prisma)).incomeCategoryId).toBe(income.id);
    for (const id of [expense.id, archived.id, foreign.id, MISSING]) {
      await expectLedgerError(updatePluggyItem(USER, item.id, { incomeCategoryId: id }, prisma), 404, "category.not_found");
    }
    expect((await prisma.pluggyItem.findUniqueOrThrow({ where: { id: item.id } })).incomeCategoryId).toBe(income.id);
    expect((await updatePluggyItem(USER, item.id, { incomeCategoryId: null }, prisma)).incomeCategoryId).toBeNull();
  });
});

describe("deletePluggyItem", () => {
  it("removes the connection with its links, keeps the booked entries, and 404s for others", async () => {
    const item = await newItem();
    await prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: "acc-1", name: "Conta", type: "BANK", capitalAccountId: f.pfChecking } });
    const booked = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-10-01", description: "Mantido" }, prisma);
    const foreign = await newItem({ userId: OTHER });

    await expectLedgerError(deletePluggyItem(USER, foreign.id, prisma), 404, "pluggy.not_found");
    await deletePluggyItem(USER, item.id, prisma);

    expect(await prisma.pluggyItem.count({ where: { id: item.id } })).toBe(0);
    expect(await prisma.pluggyAccountLink.count({ where: { itemRowId: item.id } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { id: booked.entryIds[0] } })).toBe(1);
    expect(await prisma.pluggyItem.count({ where: { id: foreign.id } })).toBe(1);
    await expectLedgerError(deletePluggyItem(USER, item.id, prisma), 404, "pluggy.not_found");
  });
});

describe("mapPluggyAccount", () => {
  async function link(type: string, itemOwner = USER) {
    const item = await newItem({ userId: itemOwner });
    return prisma.pluggyAccountLink.create({ data: { itemRowId: item.id, pluggyAccountId: `acc-${type}`, name: "Conta", type } });
  }

  it("maps a bank account to a checking, cash or brokerage account of the same entity and unmaps it with null", async () => {
    const bank = await link("BANK");
    expect((await mapPluggyAccount(USER, bank.id, f.pfChecking, prisma)).capitalAccountId).toBe(f.pfChecking);
    expect((await mapPluggyAccount(USER, bank.id, f.broker, prisma)).capitalAccountId).toBe(f.broker);
    const cash = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Carteira", currency: "BRL" } });
    expect((await mapPluggyAccount(USER, bank.id, cash.id, prisma)).capitalAccountId).toBe(cash.id);
    expect((await mapPluggyAccount(USER, bank.id, null, prisma)).capitalAccountId).toBeNull();
  });

  it("maps a credit account only to a credit card", async () => {
    const credit = await link("CREDIT");
    expect((await mapPluggyAccount(USER, credit.id, f.card, prisma)).capitalAccountId).toBe(f.card);
    await expectLedgerError(mapPluggyAccount(USER, credit.id, f.pfChecking, prisma), 422, "pluggy.account_type");
    const bank = await prisma.pluggyAccountLink.create({ data: { itemRowId: credit.itemRowId, pluggyAccountId: "acc-bank", name: "Conta", type: "BANK" } });
    await expectLedgerError(mapPluggyAccount(USER, bank.id, f.card, prisma), 422, "pluggy.account_type");
  });

  it("refuses the other entity's account, an unknown or archived account and a link that is not the user's", async () => {
    const bank = await link("BANK");
    await expectLedgerError(mapPluggyAccount(USER, bank.id, f.pjChecking, prisma), 422, "pluggy.entity_mismatch");
    await expectLedgerError(mapPluggyAccount(USER, bank.id, MISSING, prisma), 404, "account.not_found");
    await expectLedgerError(mapPluggyAccount(USER, bank.id, other.pfChecking, prisma), 404, "account.not_found");
    await expectLedgerError(mapPluggyAccount(USER, MISSING, f.pfChecking, prisma), 404, "pluggy.link_not_found");
    const foreignLink = await prisma.pluggyAccountLink.create({
      data: { itemRowId: (await newItem({ userId: OTHER, itemId: OTHER_UUID })).id, pluggyAccountId: "acc-foreign", name: "Conta", type: "BANK" },
    });
    await expectLedgerError(mapPluggyAccount(USER, foreignLink.id, f.pfChecking, prisma), 404, "pluggy.link_not_found");
    await expectLedgerError(mapPluggyAccount(USER, foreignLink.id, null, prisma), 404, "pluggy.link_not_found");
    expect((await prisma.pluggyAccountLink.findUniqueOrThrow({ where: { id: bank.id } })).capitalAccountId).toBeNull();
  });
});

describe("resolvePluggyReview", () => {
  const openReview = (kind: string, draft: object, itemRowId: string | null = null, userId = USER) =>
    prisma.pluggyReview.create({ data: { userId, itemRowId, kind, draft } });

  it("404s for a missing review and for another user's", async () => {
    const foreign = await openReview("conflict", {}, null, OTHER);
    await expectLedgerError(resolvePluggyReview(USER, MISSING, "ignore", null, prisma), 404, "pluggy.review_not_found");
    await expectLedgerError(resolvePluggyReview(USER, foreign.id, "ignore", null, prisma), 404, "pluggy.review_not_found");
    expect((await prisma.pluggyReview.findUniqueOrThrow({ where: { id: foreign.id } })).status).toBe("open");
  });

  it("ignores a review, stamping the resolution time", async () => {
    const review = await openReview("conflict", { pluggyId: "tx-1" });
    const result = await resolvePluggyReview(USER, review.id, "ignore", null, prisma);
    expect(result.status).toBe("ignored");
    expect(result.resolvedAt).toBeInstanceOf(Date);
    expect(await prisma.pluggyExternalRef.count({ where: { userId: USER } })).toBe(0);
  });

  it("returns a review that is already closed without changing it or acting on it again", async () => {
    const review = await prisma.pluggyReview.create({
      data: { userId: USER, kind: "conflict", status: "ignored", resolvedAt: new Date("2026-01-01T00:00:00.000Z"), draft: { pluggyId: "tx-1" } },
    });
    const result = await resolvePluggyReview(USER, review.id, "link", "whatever", prisma);
    expect(result.status).toBe("ignored");
    expect(result.resolvedAt?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
    expect(await prisma.pluggyExternalRef.count({ where: { userId: USER } })).toBe(0);
  });

  it("links the review to an existing entry and remembers the Pluggy id so the next sync skips it", async () => {
    const entry = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 42.5, date: "2026-10-10", description: "Manual" }, prisma);
    const review = await openReview("conflict", { pluggyId: "tx-link", reason: "multiple_matches" });

    const result = await resolvePluggyReview(USER, review.id, "link", entry.entryIds[0]!, prisma);

    expect(result.status).toBe("resolved");
    const ref = await prisma.pluggyExternalRef.findUniqueOrThrow({ where: { userId_pluggyId: { userId: USER, pluggyId: "tx-link" } } });
    expect(ref).toMatchObject({ ledgerEntryId: entry.entryIds[0], matchKind: "linked" });
  });

  it("re-points an existing Pluggy reference when it is linked again to another entry", async () => {
    const a = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-10-10", description: "A" }, prisma);
    const b = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-10-11", description: "B" }, prisma);
    await prisma.pluggyExternalRef.create({ data: { userId: USER, pluggyId: "tx-again", ledgerEntryId: a.entryIds[0], matchKind: "created" } });
    const review = await openReview("conflict", { pluggyId: "tx-again" });

    await resolvePluggyReview(USER, review.id, "link", b.entryIds[0]!, prisma);

    const refs = await prisma.pluggyExternalRef.findMany({ where: { userId: USER, pluggyId: "tx-again" } });
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ ledgerEntryId: b.entryIds[0], matchKind: "linked" });
  });

  it("resolves a link on a draft with no Pluggy id without writing a reference", async () => {
    const entry = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-10-10", description: "A" }, prisma);
    const review = await openReview("conflict", { reason: "x" });
    expect((await resolvePluggyReview(USER, review.id, "link", entry.entryIds[0]!, prisma)).status).toBe("resolved");
    expect(await prisma.pluggyExternalRef.count({ where: { userId: USER } })).toBe(0);
  });

  it("needs a target entry that is the user's own and not in the trash to link", async () => {
    const review = await openReview("conflict", { pluggyId: "tx-x" });
    await expectLedgerError(resolvePluggyReview(USER, review.id, "link", null, prisma), 422, "pluggy.link_target");
    await expectLedgerError(resolvePluggyReview(USER, review.id, "link", MISSING, prisma), 404, "entry.not_found");
    const foreign = await createEntry(OTHER, { kind: "expense", accountId: other.pfChecking, amount: 5, date: "2026-10-10", description: "Dele" }, prisma);
    await expectLedgerError(resolvePluggyReview(USER, review.id, "link", foreign.entryIds[0]!, prisma), 404, "entry.not_found");
    const trashed = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, date: "2026-10-10", description: "Lixo" }, prisma);
    await prisma.ledgerEntry.update({ where: { id: trashed.entryIds[0]! }, data: { deletedAt: new Date() } });
    await expectLedgerError(resolvePluggyReview(USER, review.id, "link", trashed.entryIds[0]!, prisma), 404, "entry.not_found");
    expect((await prisma.pluggyReview.findUniqueOrThrow({ where: { id: review.id } })).status).toBe("open");
    expect(await prisma.pluggyExternalRef.count({ where: { userId: USER } })).toBe(0);
  });

  it("never confirms amortization, a trade or a skipped row as income", async () => {
    for (const event of ["amortization", "buy", "sell", "skip"]) {
      const review = await openReview("low_confidence", { event, pluggyId: `tx-${event}`, gross: 10 });
      await expectLedgerError(resolvePluggyReview(USER, review.id, "confirm", null, prisma), 422, "pluggy.not_income");
      expect((await prisma.pluggyReview.findUniqueOrThrow({ where: { id: review.id } })).status).toBe("open");
    }
  });

  it("refuses to confirm a conflict, which has no classification to accept", async () => {
    const review = await openReview("conflict", { pluggyId: "tx-c", reason: "ambiguous" });
    await expectLedgerError(resolvePluggyReview(USER, review.id, "confirm", null, prisma), 422, "pluggy.not_income");
  });

  it("applies the broker's quantity on a position review but keeps the average cost, and rejects a malformed one", async () => {
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" }, prisma);
    const bad = await openReview("position", { holdingId: holding.id });
    await expectLedgerError(resolvePluggyReview(USER, bad.id, "confirm", null, prisma), 422, "pluggy.malformed_review");
    const worse = await openReview("position", { pluggyQuantity: 5 });
    await expectLedgerError(resolvePluggyReview(USER, worse.id, "confirm", null, prisma), 422, "pluggy.malformed_review");

    const review = await openReview("position", { holdingId: holding.id, pluggyQuantity: 7 });
    const result = await resolvePluggyReview(USER, review.id, "confirm", null, prisma);

    expect(result.status).toBe("resolved");
    const after = await prisma.investmentHolding.findUniqueOrThrow({ where: { id: holding.id } });
    expect(after.currentQuantity).toBe(7);
    const adjustment = await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: holding.id, type: "adjustment" } });
    expect(adjustment.notes).toBe("Pluggy: quantidade informada pela corretora");
  });

  it("locks the operation of a classification the user confirms instead of booking it again", async () => {
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" }, prisma);
    const op = await prisma.investmentOperation.create({
      data: { holdingId: holding.id, type: "dividend", incomeType: "dividend", totalAmount: 10, date: new Date("2026-10-01T12:00:00Z"), classificationSource: "llm" },
    });
    const stranger = await createHolding(OTHER, { accountId: other.broker, assetClass: "stocks", ticker: "VALE3", name: "Vale", currency: "BRL" }, prisma);
    const strangerOp = await prisma.investmentOperation.create({
      data: { holdingId: stranger.id, type: "dividend", incomeType: "dividend", totalAmount: 10, date: new Date("2026-10-01T12:00:00Z"), classificationSource: "llm" },
    });
    const review = await openReview("low_confidence", { event: "income", operationId: op.id, pluggyId: "tx-op" });
    const foreignReview = await openReview("low_confidence", { event: "income", operationId: strangerOp.id, pluggyId: "tx-op2" });

    await resolvePluggyReview(USER, review.id, "confirm", null, prisma);
    await resolvePluggyReview(USER, foreignReview.id, "confirm", null, prisma);

    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: op.id } })).toMatchObject({ classificationSource: "manual", syncLocked: true });
    expect(await prisma.investmentOperation.findUniqueOrThrow({ where: { id: strangerOp.id } })).toMatchObject({ classificationSource: "llm", syncLocked: false });
    expect((await prisma.pluggyReview.findUniqueOrThrow({ where: { id: review.id } })).status).toBe("resolved");
  });

  it("books a confirmed low-confidence income with the user's override and closes the review", async () => {
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currency: "BRL" }, prisma);
    const item = await newItem();
    const review = await openReview(
      "low_confidence",
      {
        event: "income",
        pluggyId: "tx-income",
        holdingId: holding.id,
        incomeType: "dividend",
        origin: "EXTERIOR",
        gross: 100,
        taxWithheld: 15,
        date: "2026-10-10",
        description: "Provento X",
        currency: "BRL",
        confidence: 0.4,
        cashAccountId: f.broker,
      },
      item.id,
    );

    await resolvePluggyReview(USER, review.id, "confirm", null, prisma, { incomeType: "jcp" });

    const op = await prisma.investmentOperation.findFirstOrThrow({ where: { holdingId: holding.id } });
    expect(op).toMatchObject({ incomeType: "jcp", classificationSource: "manual", classificationConfidence: 0.4, syncLocked: true, externalId: "tx-income", dividendOrigin: null });
    expect(Number(op.taxWithheld)).toBe(15);
    expect(Number(op.totalAmount)).toBe(100);
    const ref = await prisma.pluggyExternalRef.findUniqueOrThrow({ where: { userId_pluggyId: { userId: USER, pluggyId: "tx-income" } } });
    expect(ref).toMatchObject({ matchKind: "created", operationId: op.id, ledgerEntryId: op.cashEntryId });
    expect((await prisma.pluggyReview.findUniqueOrThrow({ where: { id: review.id } })).status).toBe("resolved");
  });
});
