import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { restoreEntries } from "@capital/server/modules/ledger/services/entries";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { createHolding, deleteOperation, recordOperation, updateOperation } from "../../services/portfolio";

const USER = "test-user-inv-restoreops-001";
let f: LedgerFixture;
let holdingId: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  holdingId = (await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "PETR4", name: "Petrobras", currentPrice: 40 }, prisma)).id;
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const buy = (extra: Partial<Parameters<typeof recordOperation>[1]> = {}) =>
  recordOperation(USER, { holdingId, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: "2026-09-01", ...extra }, prisma);
const holdingRow = () => prisma.investmentHolding.findUniqueOrThrow({ where: { id: holdingId } });
const opCount = () => prisma.investmentOperation.count({ where: { holdingId } });

describe("restoring the cash leg of a deleted operation", () => {
  it("brings the operation back with the leg and recalculates the position", async () => {
    const booked = await buy();
    await deleteOperation(USER, booked.operation.id, prisma);
    expect(await holdingRow()).toMatchObject({ currentQuantity: 0 });

    const restored = await restoreEntries(USER, [booked.cashEntryId!], prisma);
    expect(restored).toMatchObject({ restored: 1, operationsRestored: 1 });
    const op = await prisma.investmentOperation.findUniqueOrThrow({ where: { id: booked.operation.id } });
    expect(op).toMatchObject({ cashEntryId: booked.cashEntryId, type: "buy", quantity: 10, totalAmount: 300 });
    expect(await holdingRow()).toMatchObject({ currentQuantity: 10, totalInvested: 300, isActive: true });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: booked.cashEntryId! } })).deletedAt).toBeNull();
  });

  it("has no operation to bring back for entries that are not investment cash legs", async () => {
    const expense = await prisma.ledgerEntry.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        accountId: f.pfChecking,
        kind: "expense",
        amount: -20,
        currency: "BRL",
        exchangeRate: 1,
        amountBase: -20,
        date: new Date("2026-09-01T12:00:00Z"),
        effectiveDate: new Date("2026-09-01T12:00:00Z"),
        description: "Café",
        deletedAt: new Date(),
      },
    });
    expect(await restoreEntries(USER, [expense.id], prisma)).toMatchObject({ restored: 1, operationsRestored: 0 });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: expense.id } })).deletedAt).toBeNull();
  });

  it("leaves a leg that no recorded change explains to come back alone", async () => {
    const stray = await prisma.ledgerEntry.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        accountId: f.broker,
        kind: "investment",
        amount: -50,
        currency: "BRL",
        exchangeRate: 1,
        amountBase: -50,
        date: new Date("2026-09-01T12:00:00Z"),
        effectiveDate: new Date("2026-09-01T12:00:00Z"),
        description: "Perna solta",
        deletedAt: new Date(),
      },
    });
    expect(await restoreEntries(USER, [stray.id], prisma)).toMatchObject({ restored: 1, operationsRestored: 0 });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: stray.id } })).deletedAt).toBeNull();
    expect(await opCount()).toBe(0);
  });

  it("restores nothing extra for a leg whose operation still owns it", async () => {
    const booked = await buy();
    await prisma.ledgerEntry.update({ where: { id: booked.cashEntryId! }, data: { deletedAt: new Date() } });
    expect(await restoreEntries(USER, [booked.cashEntryId!], prisma)).toMatchObject({ restored: 1, operationsRestored: 0 });
    expect(await opCount()).toBe(1);
  });

  it("does not bring an operation back twice when it was recreated under its old id", async () => {
    const booked = await buy();
    await deleteOperation(USER, booked.operation.id, prisma);
    await prisma.investmentOperation.create({
      data: { id: booked.operation.id, holdingId, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: new Date("2026-09-01T12:00:00Z") },
    });
    expect(await restoreEntries(USER, [booked.cashEntryId!], prisma)).toMatchObject({ restored: 1, operationsRestored: 0 });
    expect(await opCount()).toBe(1);
  });

  it("brings only the leg back when the holding is gone", async () => {
    const other = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "VALE3", name: "Vale" }, prisma);
    const booked = await recordOperation(USER, { holdingId: other.id, type: "buy", quantity: 1, pricePerUnit: 60, totalAmount: 60, date: "2026-09-01" }, prisma);
    await deleteOperation(USER, booked.operation.id, prisma);
    await prisma.investmentHolding.delete({ where: { id: other.id } });
    expect(await restoreEntries(USER, [booked.cashEntryId!], prisma)).toMatchObject({ restored: 1, operationsRestored: 0 });
    expect(await prisma.investmentOperation.count({ where: { id: booked.operation.id } })).toBe(0);
  });

  it("refuses when the same broker note was imported again after the revert, so the cash would count twice", async () => {
    const first = await buy({ externalId: "nota-77" });
    await deleteOperation(USER, first.operation.id, prisma);
    await buy({ externalId: "nota-77", date: "2026-09-02" });
    await expect(restoreEntries(USER, [first.cashEntryId!], prisma)).rejects.toMatchObject({
      status: 409,
      code: "trash.operation_recorded_again",
      params: { description: "Compra PETR4" },
    });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: first.cashEntryId! } })).deletedAt).not.toBeNull();
    expect(await opCount()).toBe(1);
  });
});

describe("restoring the funding transfer of a deleted operation", () => {
  it("keeps the operation linked to its funding transfer while the transfer is still there and free", async () => {
    const funded = await buy({ fundFromAccountId: f.pfChecking });
    await deleteOperation(USER, funded.operation.id, prisma);
    await restoreEntries(USER, [funded.cashEntryId!], prisma);
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: funded.operation.id } })).fundingGroupId).toBe(funded.fundingGroupId);
  });

  it("drops the link when the transfer was purged from the trash", async () => {
    const funded = await buy({ fundFromAccountId: f.pfChecking });
    await deleteOperation(USER, funded.operation.id, prisma, { withFunding: true });
    await prisma.ledgerEntry.deleteMany({ where: { transferGroupId: funded.fundingGroupId! } });
    await prisma.transferGroup.delete({ where: { id: funded.fundingGroupId! } });
    await restoreEntries(USER, [funded.cashEntryId!], prisma);
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: funded.operation.id } })).fundingGroupId).toBeNull();
  });

  it("drops the link when another operation has claimed the transfer since", async () => {
    const funded = await buy({ fundFromAccountId: f.pfChecking });
    await deleteOperation(USER, funded.operation.id, prisma);
    const claimer = await buy({ date: "2026-09-03" });
    await prisma.investmentOperation.update({ where: { id: claimer.operation.id }, data: { fundingGroupId: funded.fundingGroupId } });
    await restoreEntries(USER, [funded.cashEntryId!], prisma);
    expect((await prisma.investmentOperation.findUniqueOrThrow({ where: { id: funded.operation.id } })).fundingGroupId).toBeNull();
  });
});

describe("restoring the cash leg of an operation edited to move no cash", () => {
  it("refuses while the operation is still there, since it would not count the leg", async () => {
    const booked = await buy();
    await updateOperation(USER, booked.operation.id, { type: "split", totalAmount: 0 }, prisma);
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: booked.cashEntryId! } })).deletedAt).not.toBeNull();
    await expect(restoreEntries(USER, [booked.cashEntryId!], prisma)).rejects.toMatchObject({
      status: 409,
      code: "trash.operation_edited",
      params: { description: "Compra PETR4" },
    });
    expect(toNumber((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: booked.cashEntryId! } })).amount)).toBe(-300);
  });

  it("brings the leg back alone once the operation is gone", async () => {
    const booked = await buy();
    await updateOperation(USER, booked.operation.id, { type: "split", totalAmount: 0 }, prisma);
    await prisma.investmentOperation.delete({ where: { id: booked.operation.id } });
    expect(await restoreEntries(USER, [booked.cashEntryId!], prisma)).toMatchObject({ restored: 1, operationsRestored: 0 });
    expect((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: booked.cashEntryId! } })).deletedAt).toBeNull();
  });
});
