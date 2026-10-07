import { describe, expect, it } from "vitest";
import {
  amountsClose,
  coversStatementCycle,
  looksInternational,
  normalizeMerchant,
  reconcileStatement,
  similarDescriptions,
  type StatementFileRow,
  type StatementLedgerRow,
} from "../statement-match";

const file = (over: Partial<StatementFileRow> & Pick<StatementFileRow, "key">): StatementFileRow => ({
  date: "2026-09-02",
  description: "DROGASIL 1234",
  amount: 64.3,
  installmentNumber: null,
  externalId: null,
  ...over,
});

const booked = (over: Partial<StatementLedgerRow> & Pick<StatementLedgerRow, "id">): StatementLedgerRow => ({
  date: "2026-09-02",
  description: "DROGASIL 1234",
  amount: 64.3,
  installmentNumber: null,
  externalId: null,
  scope: "target",
  manual: false,
  ...over,
});

describe("normalizeMerchant / similarDescriptions", () => {
  it("drops processor prefixes, the installment suffix and accents", () => {
    expect(normalizeMerchant("IFD*Restaurante São Jorge")).toBe("restaurante sao jorge");
    expect(normalizeMerchant("PAG*PetzVilaMariana")).toBe("petzvilamariana");
    expect(normalizeMerchant("Loja Eletronicos - Parcela 2/6")).toBe("loja eletronicos");
    expect(normalizeMerchant("Loja Eletronicos (2/6)")).toBe("loja eletronicos");
  });

  it("matches the open bill's name with the closed bill's", () => {
    expect(similarDescriptions("IFD*RESTAURANTE SABOR", "Restaurante Sabor Ltda")).toBe(true);
    expect(similarDescriptions("PAG*Petz", "PETZ VILA MARIANA")).toBe(true);
    expect(similarDescriptions("Uber *Trip", "Uber Uber *Trip Help.U")).toBe(true);
    expect(similarDescriptions("Netflix.com", "Spotify")).toBe(false);
    expect(similarDescriptions("Padaria Real", "Drogasil")).toBe(false);
  });
});

describe("amountsClose / looksInternational", () => {
  it("allows max(R$ 0,05; 1%), or 5% for a converted purchase, never across signs", () => {
    expect(amountsClose(3, 3.05, false)).toBe(true);
    expect(amountsClose(3, 3.06, false)).toBe(false);
    expect(amountsClose(10, 10.1, false)).toBe(true);
    expect(amountsClose(10, 10.11, false)).toBe(false);
    expect(amountsClose(1000, 1009, false)).toBe(true);
    expect(amountsClose(1000, 1011, false)).toBe(false);
    expect(amountsClose(100, 104.5, true)).toBe(true);
    expect(amountsClose(20, -20, false)).toBe(false);
    expect(looksInternational("OPENAI *CHATGPT SUBSCR USD 20,00")).toBe(true);
    expect(looksInternational("Padaria Real")).toBe(false);
  });
});

describe("reconcileStatement", () => {
  it("open → closed bill: a row with another date, amount and name is changed, not a duplicate", () => {
    const { matches, removed } = reconcileStatement(
      [file({ key: "c0", date: "2026-08-29", description: "RESTAURANTE SABOR", amount: 88.5 })],
      [booked({ id: "e1", date: "2026-08-28", description: "IFD*RESTAURANTE SABOR", amount: 87.9 })],
      { coversCycle: true }
    );
    expect(matches.get("c0")).toEqual({
      status: "changed",
      entryId: "e1",
      by: "fuzzy",
      diffs: [
        { field: "amount", existingValue: "87.90", ofxValue: "88.50" },
        { field: "date", existingValue: "2026-08-28", ofxValue: "2026-08-29" },
        { field: "description", existingValue: "IFD*RESTAURANTE SABOR", ofxValue: "RESTAURANTE SABOR" },
      ],
    });
    expect(removed).toEqual([]);
  });

  it("matches by FITID first, wherever the row sits, and reports what changed", () => {
    const { matches } = reconcileStatement(
      [file({ key: "c0", externalId: "fit-1", description: "Totally renamed", amount: 70, date: "2026-09-04" })],
      [booked({ id: "near", amount: 70, date: "2026-09-04", description: "Totally renamed" }), booked({ id: "far", externalId: "fit-1", scope: "elsewhere", date: "2026-08-20" })],
      { coversCycle: false }
    );
    expect(matches.get("c0")).toMatchObject({ status: "changed", entryId: "far", by: "externalId" });
  });

  it("does not trust a FITID reused for another installment or a purchase months apart", () => {
    const { matches } = reconcileStatement(
      [
        file({ key: "inst", externalId: "fit-loja", description: "Loja Eletronicos", amount: 199, installmentNumber: 3, date: "2026-06-10" }),
        file({ key: "seq", externalId: "1", description: "Padaria", amount: 12 }),
      ],
      [
        booked({ id: "inst2", externalId: "fit-loja", description: "Loja Eletronicos", amount: 199, installmentNumber: 2, date: "2026-06-10", scope: "neighbor" }),
        booked({ id: "old", externalId: "1", description: "Posto", amount: 250, date: "2026-05-02", scope: "elsewhere" }),
      ],
      { coversCycle: false }
    );
    expect(matches.get("inst")).toEqual({ status: "new" });
    expect(matches.get("seq")).toEqual({ status: "new" });
  });

  it("an identical row is a duplicate; an entry booked anyway (~dup) still answers to its FITID", () => {
    const { matches } = reconcileStatement(
      [file({ key: "a" }), file({ key: "b", externalId: "fit-2", date: "2026-09-03" })],
      [booked({ id: "e1" }), booked({ id: "e2", externalId: "fit-2~dup1", date: "2026-09-03" })],
      { coversCycle: false }
    );
    expect(matches.get("a")).toEqual({ status: "duplicate", entryId: "e1", by: "key" });
    expect(matches.get("b")).toEqual({ status: "duplicate", entryId: "e2", by: "externalId" });
  });

  it("is one to one: two identical purchases need two booked rows", () => {
    const { matches } = reconcileStatement([file({ key: "a" }), file({ key: "b" })], [booked({ id: "e1" })], { coversCycle: false });
    expect(matches.get("a")).toMatchObject({ status: "duplicate", entryId: "e1" });
    expect(matches.get("b")).toEqual({ status: "new" });
  });

  it("needs the same installment number and a date within 3 days", () => {
    const { matches } = reconcileStatement(
      [file({ key: "inst", description: "Loja Eletronicos", amount: 199, installmentNumber: 3 }), file({ key: "late", date: "2026-09-10" })],
      [booked({ id: "e1", description: "Loja Eletronicos", amount: 199, installmentNumber: 2 }), booked({ id: "e2", date: "2026-09-02" })],
      { coversCycle: false }
    );
    expect(matches.get("inst")).toEqual({ status: "new" });
    expect(matches.get("late")).toEqual({ status: "new" });
  });

  it("finds a purchase booked on the statement next to it, but does not take a look-alike there for it", () => {
    const moved = reconcileStatement([file({ key: "c0", date: "2026-09-05" })], [booked({ id: "next", date: "2026-09-05", scope: "neighbor" })], { coversCycle: true });
    expect(moved.matches.get("c0")).toEqual({ status: "duplicate", entryId: "next", by: "key" });
    // The same coffee two days earlier, on the previous statement: another purchase.
    const coffee = reconcileStatement([file({ key: "c0", date: "2026-08-07", description: "CAFE DO PONTO", amount: 8.5 })], [booked({ id: "prev", date: "2026-08-05", description: "CAFE DO PONTO", amount: 8.5, scope: "neighbor" })], { coversCycle: true });
    expect(coffee.matches.get("c0")).toEqual({ status: "new" });
    expect(coffee.removed).toEqual([]);
  });

  it("a row typed by hand matches on the exact amount alone and keeps its own description", () => {
    const { matches } = reconcileStatement(
      [file({ key: "c0", description: "MERCADOPAGO*LOJAX", amount: 35, date: "2026-09-02" })],
      [booked({ id: "hand", description: "Presente da Ana", amount: 35, date: "2026-09-01", manual: true })],
      { coversCycle: false }
    );
    expect(matches.get("c0")).toEqual({ status: "changed", entryId: "hand", by: "fuzzy", diffs: [{ field: "date", existingValue: "2026-09-01", ofxValue: "2026-09-02" }] });
  });

  it("reports the statement's rows the file no longer has only when it covers the whole cycle", () => {
    const fileRows = [file({ key: "c0" })];
    const ledger = [booked({ id: "e1" }), booked({ id: "gone", description: "Cinema", amount: 40 }), booked({ id: "other", description: "Cinema", amount: 40, scope: "neighbor" })];
    expect(reconcileStatement(fileRows, ledger, { coversCycle: true }).removed).toEqual(["gone"]);
    expect(reconcileStatement(fileRows, ledger, { coversCycle: false }).removed).toEqual([]);
  });
});

describe("coversStatementCycle", () => {
  const cycle = { cycleStart: "2026-08-06", closingDate: "2026-09-05", today: "2026-09-20" };

  it("an OFX covers the cycle when its stated range does", () => {
    expect(coversStatementCycle({ ...cycle, from: "2026-08-06", to: "2026-09-05", stated: true })).toBe(true);
    expect(coversStatementCycle({ ...cycle, from: "2026-08-07", to: "2026-09-04", stated: true })).toBe(true);
    // The open bill, exported mid-cycle.
    expect(coversStatementCycle({ ...cycle, from: "2026-08-06", to: "2026-08-25", stated: true })).toBe(false);
    expect(coversStatementCycle({ ...cycle, from: "2026-08-15", to: "2026-09-05", stated: true })).toBe(false);
    // A bill stating its whole period before it closed is still the open bill.
    expect(coversStatementCycle({ ...cycle, today: "2026-08-25", from: "2026-08-06", to: "2026-09-05", stated: true })).toBe(false);
  });

  it("a CSV covers it once the statement closed and its rows reach the last days", () => {
    expect(coversStatementCycle({ ...cycle, from: "2026-08-07", to: "2026-09-03", stated: false })).toBe(true);
    expect(coversStatementCycle({ ...cycle, from: "2026-08-07", to: "2026-08-28", stated: false })).toBe(false);
    expect(coversStatementCycle({ ...cycle, today: "2026-09-04", from: "2026-08-07", to: "2026-09-03", stated: false })).toBe(false);
    expect(coversStatementCycle({ ...cycle, from: null, to: null, stated: false })).toBe(false);
  });
});
