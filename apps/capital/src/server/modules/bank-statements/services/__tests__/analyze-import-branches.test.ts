import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { analyzeImport, type AnalyzeImportInput } from "../analyze-import";
import { BANK_FITIDS, BANK_OFX, CARD_CSV, CARD_OFX } from "./fixtures/import-files";

/**
 * analyzeImport against the ledger: which account a file belongs to, how
 * bank rows are classified (card payment, investment, entity transfer,
 * duplicate of a transfer), the AI pass, and the card bill's special rows.
 */

const USER = "test-user-analyze-import-b";
let f: LedgerFixture;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
});

/** A one-account bank OFX whose lines are `[fitId, date, amount, memo]`. */
function bankOfx(lines: [string, string, string, string][], opts: { org?: string; acct?: string } = {}) {
  const trns = lines
    .map(([fit, date, amount, memo]) => `<STMTTRN><TRNTYPE>${Number(amount) < 0 ? "DEBIT" : "CREDIT"}</TRNTYPE><DTPOSTED>${date}000000[-3:BRT]</DTPOSTED><TRNAMT>${amount}</TRNAMT><FITID>${fit}</FITID><MEMO>${memo}</MEMO></STMTTRN>`)
    .join("\n");
  return `OFXHEADER:100
<OFX>
<SIGNONMSGSRSV1><SONRS><FI><ORG>${opts.org ?? "NU PAGAMENTOS S.A."}</ORG></FI></SONRS></SIGNONMSGSRSV1>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL</CURDEF>
<BANKACCTFROM><BANKID>1</BANKID><ACCTID>${opts.acct ?? "55555-5"}</ACCTID><ACCTTYPE>CHECKING</ACCTTYPE></BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260901000000[-3:BRT]</DTSTART>
<DTEND>20260930000000[-3:BRT]</DTEND>
${trns}
</BANKTRANLIST>
<LEDGERBAL><BALAMT>10.00</BALAMT><DTASOF>20260930000000[-3:BRT]</DTASOF></LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;
}

const analyze = (files: { name: string; content: string }[], extra: Omit<AnalyzeImportInput, "files"> = {}, categorizers?: Parameters<typeof analyzeImport>[3]) =>
  analyzeImport(USER, { files, ...extra }, prisma, categorizers);
const one = (name: string, content: string, extra: Omit<AnalyzeImportInput, "files"> = {}, categorizers?: Parameters<typeof analyzeImport>[3]) => analyze([{ name, content }], extra, categorizers);
const rowsById = (a: Awaited<ReturnType<typeof analyze>>) => Object.fromEntries(a.rows.map((r) => [r.id, r]));
const account = (over: Partial<Account> & { name: string }) =>
  prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "checking", currency: "BRL", ...over } as never });

describe("which account a bank file belongs to", () => {
  const ofx = bankOfx([["x1", "20260910", "-10.00", "Compra no débito - PADARIA"]]);

  it("takes the account the dialog chose, and refuses one that is unknown, archived or not a bank account", async () => {
    const chosen = await account({ name: "Poupança" });
    expect(await one("e.ofx", ofx, { accountId: chosen.id })).toMatchObject({ suggestedAccountId: chosen.id, accountMatch: "explicit", entityId: f.pfId });
    await expect(one("e.ofx", ofx, { accountId: "nao-existe" })).rejects.toMatchObject({ status: 404, code: "account.not_found" });
    const archived = await account({ name: "Antiga", archivedAt: new Date() });
    await expect(one("e.ofx", ofx, { accountId: archived.id })).rejects.toMatchObject({ status: 422, code: "account.archived", params: { name: "Antiga" } });
    await expect(one("e.ofx", ofx, { accountId: f.card })).rejects.toMatchObject({ status: 422, code: "import.account_kind_mismatch", params: { name: "Nubank" } });
    await expect(one("e.ofx", ofx, { accountId: f.broker })).rejects.toMatchObject({ code: "import.account_kind_mismatch" });
  });

  it("finds the account by its number, even written differently", async () => {
    const withNumber = await account({ name: "Nubank PF", externalId: "0001 / 55555-5" });
    expect(await one("e.ofx", ofx)).toMatchObject({ suggestedAccountId: withNumber.id, accountMatch: "number", externalAccountId: "55555-5" });
  });

  it("takes the user's only bank account, whatever the file says", async () => {
    await prisma.account.delete({ where: { id: f.pjChecking } });
    expect(await one("e.ofx", ofx)).toMatchObject({ suggestedAccountId: f.pfChecking, accountMatch: "only" });
  });

  it("takes the one account whose institution or name mentions the bank", async () => {
    const nu = await account({ name: "Conta Nu", institution: "Nubank" });
    expect(await one("e.ofx", ofx)).toMatchObject({ suggestedAccountId: nu.id, accountMatch: "bank", entityId: f.pfId });
  });

  it("with several accounts for the bank (or none), falls back to the personal main account", async () => {
    await account({ name: "Nubank 1" });
    await account({ name: "Nubank 2" });
    expect(await one("e.ofx", ofx)).toMatchObject({ suggestedAccountId: f.pfChecking, accountMatch: "default" });
  });

  it("falls back to any main account when the personal entity has none, and to no account when none is main", async () => {
    await prisma.account.update({ where: { id: f.pfChecking }, data: { isDefault: false } });
    expect(await one("e.ofx", ofx)).toMatchObject({ suggestedAccountId: f.pjChecking, accountMatch: "default", entityId: f.pjId });
    await prisma.account.update({ where: { id: f.pjChecking }, data: { isDefault: false } });
    const none = await one("e.ofx", ofx);
    expect(none).toMatchObject({ suggestedAccountId: null, accountMatch: null, entityId: null });
    // The rows are still analysed, and the card payment has no account to be paid from.
    expect(none.rows).toHaveLength(1);
  });

  it("matches the bank name without caring about case or repeated spaces", async () => {
    const nu = await account({ name: "Conta   corrente", institution: "NUBANK   S.A." });
    await account({ name: "Outra", institution: "Itaú" });
    expect(await one("e.ofx", ofx)).toMatchObject({ suggestedAccountId: nu.id, accountMatch: "bank" });
  });
});

describe("how bank rows are classified", () => {
  it("shows a row already imported as a transfer as a duplicate of that transfer", async () => {
    const t = await createEntry(USER, { kind: "transfer", fromAccountId: f.pjChecking, toAccountId: f.pfChecking, amount: 5000, description: "Pró-labore", date: "2026-09-05", direction: "profit_distribution" }, prisma);
    await prisma.transferGroup.update({ where: { id: t.transferGroupId! }, data: { externalId: BANK_FITIDS.SALARY } });
    const a = await one("e.ofx", BANK_OFX);
    expect(rowsById(a)[BANK_FITIDS.SALARY]).toMatchObject({ status: "dup", reconciliation: "duplicate", duplicateOf: { id: t.transferGroupId, description: "Pró-labore", date: "2026-09-05" } });

    // A transfer with no description of its own falls back to the row's.
    await prisma.transferGroup.update({ where: { id: t.transferGroupId! }, data: { description: null } });
    const b = await one("e.ofx", BANK_OFX);
    expect(rowsById(b)[BANK_FITIDS.SALARY].duplicateOf).toMatchObject({ id: t.transferGroupId, description: "Pix recebido - ACME CONSULTORIA" });
  });

  it("shows what changed in a row already booked under the same FITID, with the category it has", async () => {
    const booked = await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 20, description: "Uber antigo", date: "2026-09-02", categoryId: f.categories.Groceries, externalId: BANK_FITIDS.UBER }, prisma);
    const a = await one("e.ofx", BANK_OFX);
    const row = rowsById(a)[BANK_FITIDS.UBER];
    expect(row).toMatchObject({ status: "dup", reconciliation: "changed", suggestedCategoryId: f.categories.Groceries, source: "existing", duplicateOf: { id: booked.entryIds[0], description: "Uber antigo", date: "2026-09-02" } });
    expect(row.diffs?.map((d) => d.field).sort()).toEqual(["amount", "description"]);
  });

  it("leaves the source empty when the booked duplicate has no category", async () => {
    await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 23.4, description: "UBER *TRIP", date: "2026-09-02", externalId: BANK_FITIDS.UBER }, prisma);
    const row = rowsById(await one("e.ofx", BANK_OFX))[BANK_FITIDS.UBER];
    expect(row).toMatchObject({ status: "dup", reconciliation: "duplicate", suggestedCategoryId: null, source: null });
    expect(row.diffs).toBeUndefined();
  });

  it("offers the card the bank pays when a bill payment is found, in the statement the payment settles", async () => {
    const a = await one("e.ofx", BANK_OFX);
    expect(rowsById(a)[BANK_FITIDS.BILL]).toMatchObject({ kind: "card_payment", status: "rule", source: "classification", cardPayment: { cardAccountId: f.card, statementMonth: "2026-09" } });
  });

  it("picks, among several cards, the one paid from this account, else the entity's only one, else the one named like the bank", async () => {
    const cardOf = async () => rowsById(await one("e.ofx", BANK_OFX))[BANK_FITIDS.BILL].cardPayment?.cardAccountId;
    await account({ name: "Itaú PJ", type: "credit_card", institution: "Itaú", entityId: f.pjId, closingDay: 10, dueDay: 17, payFromAccountId: f.pjChecking });
    // Only one card is paid from this account.
    expect(await cardOf()).toBe(f.card);
    // None is paid from here, and the entity (PF) has one card: that one.
    await prisma.account.update({ where: { id: f.card }, data: { payFromAccountId: null } });
    expect(await cardOf()).toBe(f.card);
    // The entity has two cards, none paid from here: the bank's name decides (Nubank).
    const itau = await account({ name: "Itaú Visa", type: "credit_card", institution: "Itaú", closingDay: 10, dueDay: 17 });
    expect(await cardOf()).toBe(f.card);
    // Both paid from here: the bank's name decides among them.
    await prisma.account.updateMany({ where: { id: { in: [f.card, itau.id] } }, data: { payFromAccountId: f.pfChecking } });
    expect(await cardOf()).toBe(f.card);
    // The bank's name is in none of them: no card, and the row stays to be settled by hand.
    await prisma.account.update({ where: { id: f.card }, data: { name: "Roxinho" } });
    expect(rowsById(await one("e.ofx", BANK_OFX))[BANK_FITIDS.BILL]).toMatchObject({ kind: "card_payment", status: "need", cardPayment: { cardAccountId: null, statementMonth: null } });
  });

  it("leaves a bill payment with no card to choose, and an incoming 'Pagamento de fatura' as a plain row", async () => {
    await prisma.account.delete({ where: { id: f.card } });
    expect(rowsById(await one("e.ofx", BANK_OFX))[BANK_FITIDS.BILL]).toMatchObject({ kind: "card_payment", status: "need", cardPayment: { cardAccountId: null, statementMonth: null } });
    const refund = bankOfx([["in1", "20260912", "30.00", "Pagamento de fatura"]]);
    expect(rowsById(await one("r.ofx", refund)).in1).toMatchObject({ kind: "entry", status: "need", type: "income", amount: 30 });
  });

  it("suggests the broker for an investment row when there is exactly one, and leaves it open with several", async () => {
    const ofx = bankOfx([
      ["inv1", "20260905", "-1000.00", "Aplicação RDB"],
      ["inv2", "20260906", "250.00", "Resgate RDB"],
    ]);
    const single = rowsById(await one("i.ofx", ofx));
    expect(single.inv1).toMatchObject({ kind: "investment_transfer", status: "rule", source: "classification", investment: { direction: "investment_deposit", accountId: f.broker } });
    expect(single.inv2).toMatchObject({ kind: "investment_transfer", investment: { direction: "investment_withdrawal", accountId: f.broker } });

    await account({ name: "Rico", type: "brokerage" });
    const several = rowsById(await one("i.ofx", ofx));
    expect(several.inv1).toMatchObject({ kind: "investment_transfer", status: "need", investment: { direction: "investment_deposit", accountId: null } });
  });

  it("recognises a transfer to the user's other entity, naming the entity and the flow", async () => {
    const ofx = bankOfx([["tr1", "20260908", "-700.00", "Transferência enviada pelo Pix - Kodama LTDA - 11.111.111/0001-11 - BCO X"]]);
    const row = rowsById(await one("t.ofx", ofx)).tr1;
    expect(row).toMatchObject({ kind: "transfer", status: "rule", source: "classification", type: "expense", amount: -700 });
    expect(row.transfer).toMatchObject({ suggestedEntityId: f.pjId, suggestedEntityName: "Kodama LTDA", suggestedEntityType: "business", suggestedFlow: "outflow", suggestedDirection: "capital_injection" });
  });

  it("asks which classification fits a row that two fit", async () => {
    const ofx = bankOfx([["amb1", "20260908", "-700.00", "Transferência enviada pelo Pix - Kodama LTDA - aplicação rdb"]]);
    const row = rowsById(await one("t.ofx", ofx)).amb1;
    expect(row).toMatchObject({ kind: "entry", status: "need" });
    expect(row.candidates?.map((c) => c.type).sort()).toEqual(["entity_transfer", "investment_transfer", "regular_transaction"]);
  });

  it("applies the user's rule to a row nothing else classified, for the imported entity", async () => {
    const rule = await prisma.categorizationRule.create({ data: { userId: USER, matchType: "contains", pattern: "padaria", categoryId: f.categories.Groceries } });
    const row = rowsById(await one("e.ofx", bankOfx([["r1", "20260910", "-10.00", "Compra no débito - PADARIA REAL"]]))).r1;
    expect(row).toMatchObject({ status: "rule", source: "rule", ruleId: rule.id, rulePattern: "padaria", suggestedCategoryId: f.categories.Groceries });
  });
});

describe("the AI pass on a bank file", () => {
  it("asks for the expenses and the incomes no rule covers, in two calls, and applies only valid, non-fallback answers", async () => {
    await prisma.category.create({ data: { userId: USER, name: "Velha", type: "expense", isArchived: true } });
    const calls: { type: string; categories: string[]; descriptions: string[] }[] = [];
    const a = await one("e.ofx", BANK_OFX, { ai: true }, {
      categorizers: {
        statement: async (rows, categories, type, fallback) => {
          calls.push({ type, categories, descriptions: rows.map((r) => r.description) });
          if (type === "income") return rows.map((r) => ({ index: r.index, category: "Salary" }));
          return [
            { index: 0, category: "Groceries" },
            { index: 1, category: "Software" },
            { index: 2, category: fallback },
            { index: 3, category: "Velha" },
            { index: 4, category: "Inexistente" },
            { index: 99, category: "Groceries" },
          ];
        },
      },
    });
    expect(calls.map((c) => c.type).sort()).toEqual(["expense", "income"]);
    const expenseCall = calls.find((c) => c.type === "expense")!;
    // The archived category is not offered; the fallback is.
    expect(expenseCall.categories).toEqual(expect.arrayContaining(["Groceries", "Software"]));
    expect(expenseCall.categories).not.toContain("Velha");
    expect(expenseCall.categories).toHaveLength(new Set(expenseCall.categories).size);
    expect(expenseCall.descriptions).toHaveLength(4);

    const aiRows = a.rows.filter((r) => r.status === "ai");
    expect(aiRows.map((r) => [r.description, r.suggestedCategoryId, r.source]).sort()).toEqual(
      [
        [expenseCall.descriptions[0], f.categories.Groceries, "ai"],
        [expenseCall.descriptions[1], f.categories.Software, "ai"],
        ["Pix recebido - ACME CONSULTORIA", f.categories.Salary, "ai"],
      ].sort()
    );
    expect(a.rows.filter((r) => r.status === "need")).toHaveLength(2);
    expect(a.ai).toEqual({ requested: true, available: true, used: true });
    expect(a.summary.counts.ai).toBe(3);
  });

  it("makes no call when every row is already settled, and reports the AI as not used", async () => {
    const seen: string[] = [];
    const ofx = bankOfx([["g1", "20260910", "-10.00", "Aplicação RDB"]]);
    const a = await one("e.ofx", ofx, { ai: true }, { categorizers: { statement: async (rows) => (seen.push(...rows.map((r) => r.description)), []) } });
    expect(seen).toEqual([]);
    expect(a.ai).toEqual({ requested: true, available: true, used: false });
  });

  it("does not ask when it was not requested, and reports it unavailable without a key or an injected categorizer", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    try {
      expect((await one("e.ofx", BANK_OFX)).ai).toEqual({ requested: false, available: false, used: false });
      const asked = await one("e.ofx", BANK_OFX, { ai: true });
      expect(asked.ai).toEqual({ requested: true, available: false, used: false });
      expect(asked.rows.some((r) => r.status === "ai")).toBe(false);
      const injected = await one("e.ofx", BANK_OFX, { ai: false }, { categorizers: { statement: async () => [] } });
      expect(injected.ai).toEqual({ requested: false, available: true, used: false });
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("card bills", () => {
  it("with no card to put the file on, lists its rows without a statement", async () => {
    await prisma.account.delete({ where: { id: f.card } });
    const a = await one("fatura.csv", CARD_CSV);
    expect(a).toMatchObject({ kind: "card_csv", bank: "Nubank", suggestedAccountId: null, accountMatch: null, entityId: null, card: null, payments: 1, count: 3, currency: null });
    expect(a.rows.map((r) => [r.id, r.description, r.amount, r.type, r.status])).toEqual([
      ["c0", "Netflix.com", -55.9, "expense", "need"],
      ["c1", "Mercado Livre", -120, "expense", "need"],
      ["c2", "Padaria Real", -12.5, "expense", "need"],
    ]);
  });

  it("takes the card the file's number ends like, or the one named like the bank among several, and none when nothing fits", async () => {
    const itau = await account({ name: "Itaú Visa", type: "credit_card", institution: "Itaú", externalId: "9999", closingDay: 10, dueDay: 17 });
    // Two cards, the OFX names the one ending in 1234.
    expect(await one("f.ofx", CARD_OFX)).toMatchObject({ suggestedAccountId: f.card, accountMatch: "number" });
    // A CSV has no number: the bank (Nubank) is in only one card's name.
    expect(await one("f.csv", CARD_CSV)).toMatchObject({ suggestedAccountId: f.card, accountMatch: "bank" });
    await prisma.account.update({ where: { id: f.card }, data: { name: "Roxinho" } });
    const none = await one("f.csv", CARD_CSV);
    expect(none).toMatchObject({ suggestedAccountId: null, accountMatch: null, card: null });
    expect(await one("f.csv", CARD_CSV, { accountId: itau.id })).toMatchObject({ suggestedAccountId: itau.id, accountMatch: "explicit", entityId: f.pfId, currency: "BRL" });
  });

  it("reads a card without closing or due day: the statement closes on the 1st and has no due date or payment", async () => {
    const loose = await account({ name: "Cartão solto", type: "credit_card", institution: "Nubank" });
    const a = await one("f.csv", CARD_CSV, { accountId: loose.id });
    expect(a.card).toMatchObject({ accountId: loose.id, month: "2026-09", closingDate: "2026-09-01", dueDate: null, payment: null, statementId: null, paid: false, payFromAccountId: null });
  });

  it("marks a row that moved to this bill from the previous statement as one that joins it", async () => {
    const imp = await prisma.import.create({ data: { userId: USER, entityId: f.pfId, accountId: f.card, ledgerCurrency: "BRL", transactionCount: 0 } });
    await importCardStatement(USER, { accountId: f.card, month: "2026-08", rows: [{ date: "2026-07-20", description: "Cafe Central", amount: 10, externalId: "fit-j" }], importId: imp.id, fallback: "none" }, prisma);
    const ofx = CARD_OFX.replace("<FITID>cc1", "<FITID>fit-j").replace("Uber *Trip", "Cafe Central").replace("20260810120000", "20260810120000").replace("-45.90", "-10.00");
    const a = await one("f.ofx", ofx);
    const row = a.rows.find((r) => r.externalId === "fit-j")!;
    expect(row).toMatchObject({ status: "changed", reconciliation: "changed", joinsStatement: true, duplicateOf: { description: "Cafe Central", date: "2026-07-20" } });
    expect(row.diffs?.map((d) => d.field)).toEqual(["date"]);
  });

  it("says a file's installment replaces the projected one already booked, only when it is the same purchase and amount", async () => {
    await importCardStatement(USER, { accountId: f.card, month: "2026-09", rows: [{ date: "2026-08-15", description: "Notebook", amount: 1000, installment: { number: 1, total: 3 } }], fallback: "none" }, prisma);
    const csv = ["date,title,amount", "2026-09-20,Padaria,12.00", "2026-08-15,Notebook - Parcela 2/3,1000.00", "2026-08-15,Tablet - Parcela 2/3,1000.00", "2026-08-15,Notebook - Parcela 2/3,900.00"].join("\n");
    const a = await one("f.csv", csv);
    expect(a.card?.month).toBe("2026-10");
    const byDesc = a.rows.map((r) => [r.description, r.amount, r.replacesProjected]);
    expect(byDesc).toEqual([
      ["Padaria", -12, undefined],
      ["Notebook", -1000, true],
      ["Tablet", -1000, false],
      ["Notebook", -900, false],
    ]);
    expect(a.rows[1].installment).toEqual({ number: 2, total: 3 });
  });

  it("asks for the bill-prompt categories of the refunds and charges alike, and ignores an answer for a row it does not have", async () => {
    const a = await one("f.csv", CARD_CSV, { ai: true }, {
      categorizers: {
        bill: async (rows, _categories, fallback) => [
          ...rows.map((r) => ({ index: r.index, category: r.index === 0 ? "Software" : fallback })),
          { index: 50, category: "Software" },
        ],
      },
    });
    expect(a.rows.map((r) => [r.description, r.status, r.suggestedCategoryId])).toEqual([
      ["Netflix.com", "ai", f.categories.Software],
      ["Mercado Livre", "need", null],
      ["Padaria Real", "need", null],
    ]);
    expect(a.ai.used).toBe(true);
  });

  it("answers a PDF with an empty analysis for the assistant to read, without touching the ledger", async () => {
    const pdf = Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(16)]).toString("base64");
    const a = await analyze([{ name: "", content: pdf }]);
    expect(a).toMatchObject({ kind: "pdf", viaAssistant: true, fileName: "arquivo-1", rows: [], count: 0, card: null, ai: { requested: false, available: false, used: false } });
    expect(a.summary).toEqual({ counts: { all: 0, dup: 0, changed: 0, removed: 0, rule: 0, ai: 0, need: 0 }, income: 0, expense: 0 });
  });
});
