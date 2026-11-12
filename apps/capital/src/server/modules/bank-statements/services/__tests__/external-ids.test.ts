import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { bookableExternalId, DUPLICATE_EXTERNAL_ID_SEPARATOR, externalIdHolder, freeExternalId } from "../external-ids";

/** An account holds each external id once, trashed rows included; a row booked again gets <id>~dup<n>. */
const USER = "test-user-external-ids-a";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

const book = (accountId: string, externalId: string) => createEntry(USER, { kind: "expense", accountId, amount: 1, description: externalId, date: "2026-09-02", externalId }, prisma).then((r) => r.entryIds[0]);

describe("external ids", () => {
  it("names the duplicate suffix", () => {
    expect(DUPLICATE_EXTERNAL_ID_SEPARATOR).toBe("~dup");
  });

  it("finds the row of the account holding an id, live or trashed, and none for another account", async () => {
    const id = await book(f.pfChecking, "fit-1");
    expect((await externalIdHolder(f.pfChecking, "fit-1", prisma))?.id).toBe(id);
    expect(await externalIdHolder(f.pjChecking, "fit-1", prisma)).toBeNull();
    await prisma.ledgerEntry.update({ where: { id }, data: { deletedAt: new Date() } });
    expect(await externalIdHolder(f.pfChecking, "fit-1", prisma)).toMatchObject({ id, deletedAt: expect.any(Date) });
  });

  it("gives the first ~dup number no row of the account holds, skipping those taken", async () => {
    expect(await freeExternalId(f.pfChecking, "fit-1", prisma)).toBe("fit-1~dup1");
    await book(f.pfChecking, "fit-1~dup1");
    expect(await freeExternalId(f.pfChecking, "fit-1", prisma)).toBe("fit-1~dup2");
    await book(f.pfChecking, "fit-1~dup3");
    await book(f.pfChecking, "fit-1~dup2");
    expect(await freeExternalId(f.pfChecking, "fit-1", prisma)).toBe("fit-1~dup4");
    // Other accounts and other ids do not count.
    expect(await freeExternalId(f.pjChecking, "fit-1", prisma)).toBe("fit-1~dup1");
    expect(await freeExternalId(f.pfChecking, "fit-2", prisma)).toBe("fit-2~dup1");
  });

  it("books under the file's own id when it is free, and under a ~dup one when the account holds it", async () => {
    expect(await bookableExternalId(f.pfChecking, "fit-1", prisma)).toBe("fit-1");
    await book(f.pfChecking, "fit-1");
    expect(await bookableExternalId(f.pfChecking, "fit-1", prisma)).toBe("fit-1~dup1");
    expect(await bookableExternalId(f.pjChecking, "fit-1", prisma)).toBe("fit-1");
  });
});
