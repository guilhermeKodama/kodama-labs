import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { toNumber } from "@capital/server/modules/ledger/lib/money";
import { undoBatch } from "@capital/server/modules/ledger/services/mutations";
import { buildImportPlan, encodeUse, initialDecisions, pickUse, setIncluded, type Decisions, type ImportAnalysis, type PlanContext } from "@/lib/import/review";
import { analyzeImport } from "../analyze-import";
import { executeImport } from "../execute-import";
import { executeRevert } from "../execute-revert";

/**
 * Importing a card bill again (the open bill first, the closed one later):
 * rows the statement has are recognised by FITID, identity or closeness,
 * a changed row updates its entry ("Mudou"), a row the bill no longer has
 * is proposed for the trash ("Saiu da fatura") only when the file covers
 * the whole cycle, and the whole commit is one undo batch.
 */

const USER = "test-user-card-reimport-fu-c";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

interface Line {
  fitId: string;
  date: string;
  amount: number;
  memo: string;
}

/** A Nubank card OFX for the card ending in 1234 (closes on the 5th): the September bill's cycle is 2026-08-06 → 2026-09-05. */
function cardOfx(start: string, end: string, lines: Line[]) {
  const day = (d: string) => d.replace(/-/g, "");
  const trns = lines
    .map(
      (l) => `<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>${day(l.date)}120000[0:GMT]
<TRNAMT>${(-l.amount).toFixed(2)}
<FITID>${l.fitId}
<MEMO>${l.memo}
</STMTTRN>`
    )
    .join("\n");
  return `OFXHEADER:100
DATA:OFXSGML
VERSION:102
<OFX>
<SIGNONMSGSRSV1><SONRS><FI><ORG>NU PAGAMENTOS S.A.</ORG></FI></SONRS></SIGNONMSGSRSV1>
<CREDITCARDMSGSRSV1>
<CCSTMTTRNRS>
<CCSTMTRS>
<CURDEF>BRL
<CCACCTFROM>
<ACCTID>5502********1234
</CCACCTFROM>
<BANKTRANLIST>
<DTSTART>${day(start)}
<DTEND>${day(end)}
${trns}
</BANKTRANLIST>
</CCSTMTRS>
</CCSTMTTRNRS>
</CREDITCARDMSGSRSV1>
</OFX>`;
}

const RESTAURANT: Line = { fitId: "open-rest", date: "2026-08-20", amount: 87.9, memo: "IFD*RESTAURANTE SABOR" };
const NETFLIX: Line = { fitId: "netflix", date: "2026-08-21", amount: 55.9, memo: "Netflix.com" };
const CINEMA: Line = { fitId: "cinema", date: "2026-08-22", amount: 40, memo: "Cinema" };
const OPEN_BILL = cardOfx("2026-08-06", "2026-08-25", [RESTAURANT, NETFLIX, CINEMA]);

/** The closed bill: the restaurant settled a day later, with another amount, name and FITID; the cinema is gone; a new purchase. */
const CLOSED_BILL = cardOfx("2026-08-06", "2026-09-05", [
  { fitId: "closed-rest", date: "2026-08-21", amount: 88.5, memo: "RESTAURANTE SABOR" },
  NETFLIX,
  { fitId: "drogasil", date: "2026-09-02", amount: 64.3, memo: "DROGASIL 1234" },
]);

/** The closed bill's lines, but exported before the cycle ended (a partial file). */
const PARTIAL_BILL = cardOfx("2026-08-06", "2026-08-28", [{ fitId: "closed-rest", date: "2026-08-21", amount: 88.5, memo: "RESTAURANTE SABOR" }, NETFLIX]);

const ctx = (): PlanContext => ({ entity: { id: f.pfId, kind: "personal" }, accountId: f.card, entityKinds: new Map(), currency: "BRL", linkPayment: false });

const analyze = (content: string, name = "nubank.ofx") => analyzeImport(USER, { files: [{ name, content }] }, prisma);

async function commit(analysis: ImportAnalysis, decisions: Decisions = initialDecisions(analysis)) {
  return executeImport(USER, buildImportPlan(analysis, decisions, ctx()), prisma, { createView: false });
}

const byDescription = (a: ImportAnalysis) => Object.fromEntries(a.rows.map((r) => [r.description, r]));
const live = () => prisma.ledgerEntry.findMany({ where: { userId: USER, accountId: f.card, deletedAt: null }, orderBy: { date: "asc" } });

/** The open bill imported, with a category picked for the restaurant. */
async function importOpenBill() {
  const open = await analyze(OPEN_BILL);
  const restaurant = open.rows.find((r) => r.description === RESTAURANT.memo)!;
  await commit(open, pickUse(initialDecisions(open), restaurant, encodeUse({ as: "category", categoryId: f.categories.Groceries })!));
  return prisma.ledgerEntry.findFirstOrThrow({ where: { userId: USER, externalId: RESTAURANT.fitId } });
}

describe("card bill imported again", () => {
  it("keeps the OFX FITID on the entries it books", async () => {
    await importOpenBill();
    expect((await live()).map((e) => e.externalId).sort()).toEqual(["cinema", "netflix", "open-rest"]);
  });

  it("open → closed: the changed row is Mudou (not a duplicate), the gone row Saiu da fatura, the new one new", async () => {
    const restaurant = await importOpenBill();
    const closed = await analyze(CLOSED_BILL);
    expect(closed.card).toMatchObject({ month: "2026-09", coversCycle: true, existingCount: 3 });
    const row = byDescription(closed);
    expect(row["RESTAURANTE SABOR"]).toMatchObject({
      status: "changed",
      reconciliation: "changed",
      externalId: "closed-rest",
      duplicateOf: { id: restaurant.id, description: "IFD*RESTAURANTE SABOR", date: "2026-08-20" },
      suggestedCategoryId: f.categories.Groceries,
    });
    expect(row["RESTAURANTE SABOR"].diffs?.map((d) => d.field).sort()).toEqual(["amount", "date", "description"]);
    expect(row["Netflix.com"]).toMatchObject({ status: "dup", reconciliation: "duplicate" });
    expect(row["DROGASIL 1234"]).toMatchObject({ status: "need", reconciliation: "new" });
    expect(row["Cinema"]).toMatchObject({ status: "removed", id: expect.stringMatching(/^rm:/) });
    expect(closed.count).toBe(3);
    expect(closed.summary.counts).toMatchObject({ changed: 1, dup: 1, removed: 1, need: 1 });

    // Removing is opt-in: checked here, the whole commit is one batch.
    const decisions = setIncluded(initialDecisions(closed), row["Cinema"], true);
    const result = await commit(closed, decisions);
    expect(result).toMatchObject({ reconciled: 1, cardRowsCreated: 1, cardRowsSkipped: 0, cardRowsRemoved: 1 });

    const after = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: restaurant.id } });
    expect(after).toMatchObject({ description: "RESTAURANTE SABOR", categoryId: f.categories.Groceries, externalId: "closed-rest", cardStatementId: restaurant.cardStatementId });
    expect(toNumber(after.amount)).toBe(-88.5);
    expect(after.date.toISOString().slice(0, 10)).toBe("2026-08-21");
    expect((await live()).map((e) => e.description).sort()).toEqual(["DROGASIL 1234", "Netflix.com", "RESTAURANTE SABOR"]);

    // Analysed again, the closed bill is all duplicates: nothing to update, add or remove.
    const third = await analyze(CLOSED_BILL);
    expect(third.rows.map((r) => r.status)).toEqual(["dup", "dup", "dup"]);

    // Undo puts the statement back as the open bill left it.
    await undoBatch(USER, result.batchId, prisma);
    const undone = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: restaurant.id } });
    expect(undone).toMatchObject({ description: "IFD*RESTAURANTE SABOR", externalId: "open-rest", categoryId: f.categories.Groceries });
    expect(toNumber(undone.amount)).toBe(-87.9);
    expect((await live()).map((e) => e.description).sort()).toEqual(["Cinema", "IFD*RESTAURANTE SABOR", "Netflix.com"]);
  });

  it("reverting the import (Desfazer importação) puts the changed and the removed rows back", async () => {
    const restaurant = await importOpenBill();
    const closed = await analyze(CLOSED_BILL);
    const cinema = closed.rows.find((r) => r.status === "removed")!;
    const result = await commit(closed, setIncluded(initialDecisions(closed), cinema, true));
    expect(result.cardRowsRemoved).toBe(1);

    await executeRevert(USER, { statementImportId: result.importId, createdRecords: [] }, prisma);
    const reverted = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: restaurant.id } });
    expect(reverted).toMatchObject({ description: "IFD*RESTAURANTE SABOR", externalId: "open-rest", categoryId: f.categories.Groceries, deletedAt: null });
    expect(toNumber(reverted.amount)).toBe(-87.9);
    expect((await live()).map((e) => e.description).sort()).toEqual(["Cinema", "IFD*RESTAURANTE SABOR", "Netflix.com"]);
  });

  it("leaves a row that left the bill alone unless it is checked", async () => {
    await importOpenBill();
    const closed = await analyze(CLOSED_BILL);
    const result = await commit(closed);
    expect(result.cardRowsRemoved).toBe(0);
    expect((await live()).map((e) => e.description)).toContain("Cinema");
  });

  it("commits a removal alone (Aplicar 1 alteração): the changed and new rows unchecked stay as they are", async () => {
    const restaurant = await importOpenBill();
    const closed = await analyze(CLOSED_BILL);
    let d = initialDecisions(closed);
    for (const r of closed.rows) d = setIncluded(d, r, r.status === "removed");
    const result = await commit(closed, d);
    expect(result).toMatchObject({ reconciled: 0, cardRowsCreated: 0, cardRowsRemoved: 1 });
    expect((await live()).map((e) => e.description).sort()).toEqual(["IFD*RESTAURANTE SABOR", "Netflix.com"]);
    expect(toNumber((await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: restaurant.id } })).amount)).toBe(-87.9);
  });

  it("a partial file never proposes a removal", async () => {
    await importOpenBill();
    const partial = await analyze(PARTIAL_BILL);
    expect(partial.card?.coversCycle).toBe(false);
    expect(partial.rows.map((r) => [r.description, r.status])).toEqual([
      ["RESTAURANTE SABOR", "changed"],
      ["Netflix.com", "dup"],
    ]);
  });

  it("matches by FITID even when nothing else is alike", async () => {
    const restaurant = await importOpenBill();
    const renamed = await analyze(cardOfx("2026-08-06", "2026-09-05", [{ ...RESTAURANT, date: "2026-08-24", amount: 120, memo: "SABOR GASTRONOMIA" }]));
    expect(renamed.rows[0]).toMatchObject({ status: "changed", duplicateOf: { id: restaurant.id } });
  });

  it("the commit's safety net skips a row booked since the analysis", async () => {
    await importOpenBill();
    const closed = await analyze(CLOSED_BILL);
    await commit(closed);
    // The same (now stale) plan again: the restaurant is updated to the same values, the drugstore is not booked twice.
    const again = await commit(closed);
    expect(again).toMatchObject({ cardRowsCreated: 0, cardRowsSkipped: 1 });
    expect((await live()).filter((e) => e.description === "DROGASIL 1234")).toHaveLength(1);
  });
});
