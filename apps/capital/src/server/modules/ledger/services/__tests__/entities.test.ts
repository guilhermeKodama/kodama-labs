import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import {
  archiveEntity,
  createEntity,
  getDefaultAccount,
  getOwnedEntity,
  getPersonalEntity,
  legacyEntityRef,
  listEntities,
  listEntitiesWithAccountCounts,
  patchEntity,
  resolveLegacyEntity,
  updateEntity,
} from "../entities";
import { undoBatch, type MutationRecordInput } from "../mutations";

const USER = "test-user-ledger-entities-001";
const OTHER = "test-user-ledger-entities-002";
const BARE = "test-user-ledger-entities-003";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  await createLedgerFixture(prisma, OTHER);
  await prisma.user.deleteMany({ where: { id: BARE } });
});

afterAll(async () => {
  for (const id of [USER, OTHER, BARE]) await deleteLedgerFixture(prisma, id);
});

describe("listing", () => {
  it("hides archived entities unless asked and counts only unarchived accounts", async () => {
    const extra = await createEntity(USER, { name: "Loja" }, prisma);
    await archiveEntity(USER, extra.id, true, prisma);
    expect((await listEntities(USER, prisma)).map((e) => e.name).sort()).toEqual(["Kodama LTDA", "PF"]);
    expect((await listEntities(USER, prisma, { includeArchived: true })).map((e) => e.name).sort()).toEqual(["Kodama LTDA", "Loja", "PF"]);

    await prisma.account.update({ where: { id: f.broker }, data: { archivedAt: new Date() } });
    const counts = Object.fromEntries((await listEntitiesWithAccountCounts(USER, prisma, { includeArchived: true })).map((e) => [e.name, e.accountsCount]));
    expect(counts).toEqual({ PF: 2, "Kodama LTDA": 1, Loja: 1 });
  });

  it("reports zero accounts for an entity whose accounts are all archived", async () => {
    await prisma.account.updateMany({ where: { entityId: f.pjId }, data: { archivedAt: new Date() } });
    const pj = (await listEntitiesWithAccountCounts(USER, prisma)).find((e) => e.id === f.pjId)!;
    expect(pj.accountsCount).toBe(0);
  });
});

describe("getOwnedEntity, getDefaultAccount and getPersonalEntity", () => {
  it("404s on an entity of another user", async () => {
    await expect(getOwnedEntity(OTHER, f.pfId, prisma)).rejects.toMatchObject({ status: 404, code: "entity.not_found" });
    expect((await getOwnedEntity(USER, f.pfId, prisma)).name).toBe("PF");
  });

  it("creates the main account on demand for an entity that predates it", async () => {
    const legacy = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Antiga", defaultCurrency: "USD" } });
    expect(await prisma.account.count({ where: { entityId: legacy.id } })).toBe(0);
    const account = await getDefaultAccount(legacy, prisma);
    expect(account).toMatchObject({ entityId: legacy.id, isDefault: true, type: "checking", name: "Conta principal", currency: "USD" });
    const again = await getDefaultAccount(legacy, prisma);
    expect(again.id).toBe(account.id);
    expect(await prisma.account.count({ where: { entityId: legacy.id } })).toBe(1);
  });

  it("returns the existing PF, and creates one with its main account for a user without", async () => {
    expect((await getPersonalEntity(USER, prisma)).id).toBe(f.pfId);

    await prisma.user.create({ data: { id: BARE, email: `${BARE}@example.com`, passwordHash: "x", name: BARE, baseCurrency: "EUR" } });
    const pf = await getPersonalEntity(BARE, prisma);
    expect(pf).toMatchObject({ kind: "personal", name: "PF", defaultCurrency: "EUR" });
    const main = await prisma.account.findFirstOrThrow({ where: { entityId: pf.id } });
    expect(main).toMatchObject({ isDefault: true, currency: "EUR" });
    expect((await getPersonalEntity(BARE, prisma)).id).toBe(pf.id);
  });

  it("404s on a user that does not exist", async () => {
    await expect(getPersonalEntity("test-user-ledger-entities-ghost", prisma)).rejects.toMatchObject({ status: 404, code: "user.not_found" });
  });
});

describe("createEntity", () => {
  it("creates a business with its main account in the user's base currency, in one undoable batch", async () => {
    const e = await createEntity(USER, { name: "Studio", description: "Design", taxRate: 6, color: "#123456" }, prisma);
    expect(e).toMatchObject({ kind: "business", name: "Studio", description: "Design", defaultCurrency: "BRL", color: "#123456" });
    expect(Number(e.taxRate)).toBe(6);
    const main = await prisma.account.findFirstOrThrow({ where: { entityId: e.id } });
    expect(main).toMatchObject({ isDefault: true, name: "Conta principal", currency: "BRL" });
    expect(e.batchId).not.toBeNull();

    await undoBatch(USER, e.batchId!, prisma);
    expect(await prisma.entity.count({ where: { id: e.id } })).toBe(0);
    expect(await prisma.account.count({ where: { entityId: e.id } })).toBe(0);
  });

  it("takes the default currency and the opening balance of the main account from the input", async () => {
    const e = await createEntity(USER, { name: "Offshore", defaultCurrency: "USD", initialBalance: 2500 }, prisma);
    const main = await prisma.account.findFirstOrThrow({ where: { entityId: e.id } });
    expect(main.currency).toBe("USD");
    expect(Number(main.initialBalance)).toBe(2500);
  });

  it("hands the records to the caller's batch instead of recording one", async () => {
    const collect: MutationRecordInput[] = [];
    const e = await createEntity(USER, { name: "Coletada" }, prisma, { collect });
    expect(e.batchId).toBeNull();
    expect(collect.map((r) => r.model)).toEqual(["Entity", "Account"]);
    expect(collect[0].recordId).toBe(e.id);
  });

  it("refuses a second personal entity (409) and a user that does not exist (404)", async () => {
    await expect(createEntity(USER, { kind: "personal", name: "Outro PF" }, prisma)).rejects.toMatchObject({ status: 409, code: "entity.personal_exists" });
    await expect(createEntity("test-user-ledger-entities-ghost", { name: "X" }, prisma)).rejects.toMatchObject({ status: 404, code: "user.not_found" });
  });

  it("creates the PF for a user that has none", async () => {
    await prisma.user.create({ data: { id: BARE, email: `${BARE}@example.com`, passwordHash: "x", name: BARE } });
    const pf = await createEntity(BARE, { kind: "personal", name: "PF" }, prisma);
    expect(pf.kind).toBe("personal");
  });
});

describe("updateEntity", () => {
  it("edits the fields given and the opening balance of the main account, undoing both", async () => {
    const r = await updateEntity(USER, f.pjId, { name: "Kodama SA", description: "Holding", defaultCurrency: "USD", taxRate: 15.5, color: "#abcdef", initialBalance: 1000 }, prisma);
    expect(r).toMatchObject({ name: "Kodama SA", description: "Holding", defaultCurrency: "USD", color: "#abcdef" });
    expect(Number(r.taxRate)).toBe(15.5);
    expect(Number((await prisma.account.findUniqueOrThrow({ where: { id: f.pjChecking } })).initialBalance)).toBe(1000);

    await undoBatch(USER, r.batchId!, prisma);
    const back = await prisma.entity.findUniqueOrThrow({ where: { id: f.pjId } });
    expect(back).toMatchObject({ name: "Kodama LTDA", defaultCurrency: "BRL", description: null });
    expect(Number((await prisma.account.findUniqueOrThrow({ where: { id: f.pjChecking } })).initialBalance)).toBe(0);
  });

  it("changes nothing but the fields in the patch", async () => {
    const before = await prisma.entity.findUniqueOrThrow({ where: { id: f.pjId } });
    const r = await updateEntity(USER, f.pjId, { color: "#000000" }, prisma);
    expect(r.name).toBe(before.name);
    expect(r.color).toBe("#000000");
    expect(await prisma.account.count({ where: { entityId: f.pjId } })).toBe(1);
  });

  it("lets the PF keep its name but not take another", async () => {
    const same = await updateEntity(USER, f.pfId, { name: "PF", color: "#111111" }, prisma);
    expect(same.color).toBe("#111111");
    await expect(updateEntity(USER, f.pfId, { name: "Pessoal" }, prisma)).rejects.toMatchObject({ status: 422, code: "entity.personal_rename" });
  });

  it("creates the main account when an old entity gets an opening balance", async () => {
    const legacy = await prisma.entity.create({ data: { userId: USER, kind: "business", name: "Antiga", defaultCurrency: "BRL" } });
    await updateEntity(USER, legacy.id, { initialBalance: 50 }, prisma);
    const main = await prisma.account.findFirstOrThrow({ where: { entityId: legacy.id } });
    expect(Number(main.initialBalance)).toBe(50);
  });

  it("collects the records into the caller's batch", async () => {
    const collect: MutationRecordInput[] = [];
    const r = await updateEntity(USER, f.pjId, { name: "Coletada" }, prisma, { collect });
    expect(r.batchId).toBeNull();
    expect(collect).toHaveLength(1);
    expect(collect[0]).toMatchObject({ model: "Entity", recordId: f.pjId });
  });

  it("404s for someone else's entity", async () => {
    await expect(updateEntity(OTHER, f.pjId, { name: "X" }, prisma)).rejects.toMatchObject({ status: 404, code: "entity.not_found" });
  });
});

describe("archiveEntity and patchEntity", () => {
  it("archives and unarchives a business, keeping the first archive date", async () => {
    const archived = await archiveEntity(USER, f.pjId, true, prisma);
    expect(archived.archivedAt).toBeInstanceOf(Date);
    const again = await archiveEntity(USER, f.pjId, true, prisma);
    expect(again.archivedAt!.getTime()).toBe(archived.archivedAt!.getTime());
    const back = await archiveEntity(USER, f.pjId, false, prisma);
    expect(back.archivedAt).toBeNull();
    expect(back.batchId).not.toBeNull();
  });

  it("never archives the PF", async () => {
    await expect(archiveEntity(USER, f.pfId, true, prisma)).rejects.toMatchObject({ status: 422, code: "entity.personal_archive" });
    expect((await prisma.entity.findUniqueOrThrow({ where: { id: f.pfId } })).archivedAt).toBeNull();
  });

  it("patch archives and edits as one batch that undo reverts together", async () => {
    const r = await patchEntity(USER, f.pjId, { archived: true, name: "Encerrada" }, prisma);
    expect(r.name).toBe("Encerrada");
    expect(r.archivedAt).toBeInstanceOf(Date);
    const batch = await prisma.mutationBatch.findUniqueOrThrow({ where: { id: r.batchId! } });
    expect(batch.op).toBe("entity.archive");
    await undoBatch(USER, r.batchId!, prisma);
    expect(await prisma.entity.findUniqueOrThrow({ where: { id: f.pjId } })).toMatchObject({ name: "Kodama LTDA", archivedAt: null });
  });

  it("names the batch by what the patch did: update without archived, unarchive when false", async () => {
    const edit = await patchEntity(USER, f.pjId, { color: "#222222" }, prisma);
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: edit.batchId! } })).op).toBe("entity.update");
    await archiveEntity(USER, f.pjId, true, prisma);
    const restored = await patchEntity(USER, f.pjId, { archived: false }, prisma);
    expect((await prisma.mutationBatch.findUniqueOrThrow({ where: { id: restored.batchId! } })).op).toBe("entity.unarchive");
    expect(restored.archivedAt).toBeNull();
  });

  it("records nothing for an empty patch", async () => {
    const before = await prisma.mutationBatch.count({ where: { userId: USER } });
    const r = await patchEntity(USER, f.pjId, {}, prisma);
    expect(r.batchId).toBeNull();
    expect(await prisma.mutationBatch.count({ where: { userId: USER } })).toBe(before);
  });
});

describe("legacy entity references", () => {
  it("resolves a business or personal id the user owns", async () => {
    expect((await resolveLegacyEntity(USER, { businessId: f.pjId }, prisma)).id).toBe(f.pjId);
    expect((await resolveLegacyEntity(USER, { personalAccountId: f.pfId, entityType: "personal" }, prisma)).id).toBe(f.pfId);
  });

  it("names what was not found by the kind of reference", async () => {
    await expect(resolveLegacyEntity(OTHER, { businessId: f.pjId }, prisma)).rejects.toMatchObject({ status: 404, code: "entity.not_found", message: "Business not found" });
    await expect(resolveLegacyEntity(OTHER, { personalAccountId: f.pfId }, prisma)).rejects.toMatchObject({ status: 404, message: "Personal account not found" });
  });

  it("refuses an id of the other kind", async () => {
    await expect(resolveLegacyEntity(USER, { businessId: f.pjId, entityType: "personal" }, prisma)).rejects.toMatchObject({
      status: 422,
      code: "entity.kind_mismatch",
      params: { id: f.pjId, kind: "personal" },
    });
  });

  it("falls back to the PF without an id, but wants a business id for business entries", async () => {
    expect((await resolveLegacyEntity(USER, {}, prisma)).id).toBe(f.pfId);
    expect((await resolveLegacyEntity(USER, { entityType: "personal" }, prisma)).id).toBe(f.pfId);
    await expect(resolveLegacyEntity(USER, { entityType: "business" }, prisma)).rejects.toMatchObject({ status: 422, code: "entity.business_required" });
  });

  it("maps an entity back to the legacy pair", () => {
    expect(legacyEntityRef({ id: "b1", kind: "business" })).toEqual({ entityType: "business", businessId: "b1", personalAccountId: null });
    expect(legacyEntityRef({ id: "p1", kind: "personal" })).toEqual({ entityType: "personal", businessId: null, personalAccountId: "p1" });
  });
});
