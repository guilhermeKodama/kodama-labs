import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { StatementFileType } from "@/generated/prisma";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { importCardStatement } from "@capital/server/modules/credit-cards/services/import-card-statement";
import { createHolding, recordOperation } from "@capital/server/modules/investments/services/portfolio";
import { MAX_IMAGES_PER_TURN } from "../../../constants";
import { TOOL_MEDIA_KEY, executeTool, type AnyAgentToolDef, type ToolContext } from "../registry";
import { getParsedRows } from "../read/get-parsed-rows";
import { listStatementFiles } from "../read/list-statement-files";
import { queryInvestmentHoldings } from "../read/query-investment-holdings";
import { readAttachment } from "../read/read-attachment";
import { reconcileStatement } from "../read/reconcile-statement";
import { searchTransactions } from "../read/search-transactions";
import { searchTransfers } from "../read/search-transfers";
import { searchBillTransactions } from "../read/search-bill-transactions";
import { listCreditCardBills } from "../read/list-credit-card-bills";

const USER = "test-user-assistant-tools-read";
const OTHER = "test-user-assistant-tools-read-other";

let f: LedgerFixture;
let other: LedgerFixture;
let ctx: ToolContext;

// Parses the input the way executeTool does (defaults included), then calls the handler.
const run = (tool: AnyAgentToolDef, input: unknown) => tool.handler(ctx, tool.inputSchema.parse(input));
const out = <T>(value: unknown) => value as T;

beforeAll(async () => {
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
  const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "read tools" } });
  ctx = { userId: USER, conversationId: conversation.id, turnId: "turn-1", db: prisma };
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

async function addFile(
  name: string,
  fileType: StatementFileType,
  opts: { parseStatus?: string; parsedPayload?: object; parseError?: string; statementKind?: string; createdAt?: Date; conversationId?: string } = {}
) {
  return prisma.conversationFile.create({
    data: {
      conversationId: opts.conversationId ?? ctx.conversationId,
      userId: USER,
      fileType,
      statementKind: opts.statementKind ?? null,
      blobUrl: `blob://${name}`,
      pathname: name,
      mimeType: "application/octet-stream",
      sizeBytes: name.length * 100,
      originalName: name,
      parseStatus: opts.parseStatus ?? "pending",
      parsedPayload: opts.parsedPayload,
      parseError: opts.parseError,
      createdAt: opts.createdAt,
    },
  });
}

const csvRow = (n: number) => ({ date: `2026-06-${String(n).padStart(2, "0")}`, description: `Compra ${n}`, amount: n * 10, isPayment: false });

describe("get_parsed_rows", () => {
  let csvId: string;

  beforeAll(async () => {
    const rows = Array.from({ length: 7 }, (_, i) => csvRow(i + 1));
    csvId = (await addFile("fatura.csv", "csv", { parseStatus: "parsed", parsedPayload: { kind: "card_csv", rows } })).id;
  });

  it("pages through the parsed rows, saying whether more remain", async () => {
    const first = out<{ rows: { description: string }[] }>(await run(getParsedRows, { fileId: csvId, limit: 3 }));
    expect(first).toMatchObject({ fileId: csvId, totalRows: 7, offset: 0, hasMore: true });
    expect(first.rows.map((r) => r.description)).toEqual(["Compra 1", "Compra 2", "Compra 3"]);

    const last = out<{ rows: { description: string }[] }>(await run(getParsedRows, { fileId: csvId, offset: 5, limit: 3 }));
    expect(last).toMatchObject({ totalRows: 7, offset: 5, hasMore: false });
    expect(last.rows.map((r) => r.description)).toEqual(["Compra 6", "Compra 7"]);
  });

  it("returns every row at once under the default page size, and an empty page past the end", async () => {
    const all = await run(getParsedRows, { fileId: csvId });
    expect(all).toMatchObject({ totalRows: 7, offset: 0, hasMore: false });
    expect(all.rows).toHaveLength(7);
    expect(await run(getParsedRows, { fileId: csvId, offset: 7 })).toMatchObject({ rows: [], hasMore: false });
  });

  it("rejects out-of-range paging before it reaches the handler", () => {
    expect(getParsedRows.inputSchema.safeParse({ fileId: csvId, limit: 51 }).success).toBe(false);
    expect(getParsedRows.inputSchema.safeParse({ fileId: csvId, offset: -1 }).success).toBe(false);
  });

  it("explains why a PDF, an image, an unparsed or a missing file has no rows", async () => {
    const pdf = await addFile("nota.pdf", "pdf", { parseStatus: "not_applicable" });
    const image = await addFile("print.png", "image", { parseStatus: "not_applicable" });
    const failed = await addFile("quebrado.csv", "csv", { parseStatus: "failed", parseError: "formato invalido" });
    const pending = await addFile("pendente.csv", "csv", { parseStatus: "pending" });
    const parsedWithoutPayload = await addFile("vazio.csv", "csv", { parseStatus: "parsed" });

    await expect(run(getParsedRows, { fileId: pdf.id })).rejects.toThrow(/This is a PDF/);
    await expect(run(getParsedRows, { fileId: image.id })).rejects.toThrow(/This is an image/);
    await expect(run(getParsedRows, { fileId: failed.id })).rejects.toThrow("File is not parsed (status: failed)");
    await expect(run(getParsedRows, { fileId: pending.id })).rejects.toThrow("File is not parsed (status: pending)");
    await expect(run(getParsedRows, { fileId: parsedWithoutPayload.id })).rejects.toThrow("File is not parsed (status: parsed)");
    await expect(run(getParsedRows, { fileId: "missing-file" })).rejects.toThrow("File not found in this conversation");
  });

  it("does not see files of another conversation", async () => {
    const elsewhere = await prisma.agentConversation.create({ data: { userId: USER, title: "outra" } });
    const file = await addFile("outra.csv", "csv", { conversationId: elsewhere.id, parseStatus: "parsed", parsedPayload: { kind: "card_csv", rows: [csvRow(1)] } });
    await expect(run(getParsedRows, { fileId: file.id })).rejects.toThrow("File not found in this conversation");
  });
});

describe("list_statement_files", () => {
  it("summarises OFX and CSV files and leaves PDFs, images and unparsed files without a summary", async () => {
    const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "lista" } });
    const scoped: ToolContext = { ...ctx, conversationId: conversation.id };
    const at = (n: number) => new Date(`2026-02-0${n}T10:00:00Z`);
    const ofx = await addFile("extrato.ofx", "ofx", {
      conversationId: conversation.id,
      statementKind: "bank_ofx",
      parseStatus: "parsed",
      createdAt: at(1),
      parsedPayload: {
        kind: "bank_ofx",
        bankName: "Nubank",
        accountId: "1",
        currency: "BRL",
        ledgerBalance: 321.45,
        balanceDate: "2026-01-31",
        dateStart: "2026-01-01",
        dateEnd: "2026-01-31",
        rows: [{ fitId: "a", date: "2026-01-05", description: "x", fullDescription: "x", amount: -1, type: "expense" }],
      },
    });
    const csv = await addFile("fatura.csv", "csv", { conversationId: conversation.id, statementKind: "card_csv", parseStatus: "parsed", createdAt: at(2), parsedPayload: { kind: "card_csv", rows: [csvRow(1), csvRow(2)] } });
    const pdf = await addFile("nota.pdf", "pdf", { conversationId: conversation.id, statementKind: "investment_pdf", parseStatus: "not_applicable", createdAt: at(3) });
    const broken = await addFile("ruim.csv", "csv", { conversationId: conversation.id, parseStatus: "failed", parseError: "coluna ausente", createdAt: at(4) });
    const pendingOfx = await addFile("lento.ofx", "ofx", { conversationId: conversation.id, parseStatus: "pending", createdAt: at(5), parsedPayload: { kind: "bank_ofx", rows: [] } });

    const { files } = out<{ files: Record<string, unknown>[] }>(await listStatementFiles.handler(scoped, listStatementFiles.inputSchema.parse({})));
    expect(files.map((x) => x.fileId)).toEqual([ofx.id, csv.id, pdf.id, broken.id, pendingOfx.id]);
    expect(files[0]).toEqual({
      fileId: ofx.id,
      originalName: "extrato.ofx",
      fileType: "ofx",
      statementKind: "bank_ofx",
      sizeBytes: "extrato.ofx".length * 100,
      parseStatus: "parsed",
      parseError: null,
      summary: { bankName: "Nubank", currency: "BRL", dateStart: "2026-01-01", dateEnd: "2026-01-31", ledgerBalance: 321.45, rowCount: 1 },
    });
    expect(files[1]).toMatchObject({ fileType: "csv", summary: { rowCount: 2 } });
    expect(files[2]).toMatchObject({ fileType: "pdf", statementKind: "investment_pdf", summary: null });
    expect(files[3]).toMatchObject({ parseStatus: "failed", parseError: "coluna ausente", summary: null });
    // A payload that is not "parsed" yet is never summarised.
    expect(files[4]).toMatchObject({ parseStatus: "pending", summary: null });
  });

  it("is empty for a conversation without files", async () => {
    const empty = await prisma.agentConversation.create({ data: { userId: USER, title: "vazia" } });
    expect(await listStatementFiles.handler({ ...ctx, conversationId: empty.id }, {})).toEqual({ files: [] });
  });
});

describe("query_investment_holdings", () => {
  it("returns accounts and holdings, optionally for one account, and refuses a stranger's account", async () => {
    const holding = await createHolding(USER, { accountId: f.broker, assetClass: "stocks", ticker: "petr4", name: "Petrobras" }, prisma);
    await recordOperation(USER, { holdingId: holding.id, type: "buy", quantity: 10, pricePerUnit: 30, totalAmount: 300, date: "2026-03-10", externalId: "buy-1" }, prisma);

    const all = out<{ accounts: { id: string; holdings: { ticker: string; transactions: { externalId: string }[] }[] }[] }>(await run(queryInvestmentHoldings, {}));
    expect(all.accounts.map((a) => a.id)).toEqual([f.broker]);
    expect(all.accounts[0].holdings).toMatchObject([{ ticker: "PETR4", currentQuantity: 10, transactions: [{ externalId: "buy-1", type: "buy", totalAmount: 300 }] }]);

    const one = out<{ accounts: { id: string }[] }>(await run(queryInvestmentHoldings, { accountId: f.broker }));
    expect(one.accounts.map((a) => a.id)).toEqual([f.broker]);

    await expect(run(queryInvestmentHoldings, { accountId: other.broker })).rejects.toThrow("Investment account not found or access denied");
  });
});

describe("read_attachment", () => {
  let entryId: string;
  let readableIds: string[];
  let unreadableId: string;

  beforeAll(async () => {
    entryId = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 99, date: "2026-03-01", description: "Notebook" }, prisma)).entryIds[0];
    const make = (name: string, mimeType: string, minute: number) =>
      prisma.attachment.create({
        data: { kind: "RECEIPT", blobUrl: `blob://${name}`, pathname: name, mimeType, sizeBytes: 100, originalName: name, ledgerEntryId: entryId, uploadedAt: new Date(`2026-03-01T10:${String(minute).padStart(2, "0")}:00Z`) },
      });
    const readable: string[] = [];
    // Seven readable files (the cap is five) and one the model cannot read, uploaded in between.
    for (const [i, [name, mime]] of (
      [
        ["a.png", "image/png"],
        ["b.jpg", "image/jpeg"],
        ["c.pdf", "application/pdf"],
        ["d.webp", "image/webp"],
      ] as const
    ).entries()) {
      readable.push((await make(name, mime, i)).id);
    }
    unreadableId = (await make("e.txt", "text/plain", 4)).id;
    for (const [i, [name, mime]] of ([["f.gif", "image/gif"], ["g.png", "image/png"], ["h.png", "image/png"]] as const).entries()) {
      readable.push((await make(name, mime, 5 + i)).id);
    }
    readableIds = readable;
  });

  it("loads at most the per-turn cap of readable files, in upload order, and reports every attachment", async () => {
    const result = await run(readAttachment, { ownerType: "transaction", ownerId: entryId });
    expect(result.loadedCount).toBe(MAX_IMAGES_PER_TURN);
    expect(result.skippedCount).toBe(8 - MAX_IMAGES_PER_TURN);

    const media = out<{ attachmentId: string; originalName: string; blobUrl: string; mediaType: string }[]>(result[TOOL_MEDIA_KEY]);
    expect(media.map((m) => m.attachmentId)).toEqual(readableIds.slice(0, MAX_IMAGES_PER_TURN));
    expect(media[2]).toEqual({ attachmentId: readableIds[2], originalName: "c.pdf", blobUrl: "blob://c.pdf", mediaType: "application/pdf" });

    const attachments = out<{ attachmentId: string; loaded: boolean; kind: string; mimeType: string; sizeBytes: number }[]>(result.attachments);
    expect(attachments).toHaveLength(8);
    expect(attachments.find((a) => a.attachmentId === unreadableId)).toMatchObject({ loaded: false, mimeType: "text/plain", kind: "RECEIPT", sizeBytes: 100 });
    expect(attachments.filter((a) => a.loaded).map((a) => a.attachmentId)).toEqual(readableIds.slice(0, MAX_IMAGES_PER_TURN));
    expect(attachments.find((a) => a.attachmentId === readableIds[6])?.loaded).toBe(false);
  });

  it("loads one attachment when asked for it, even an unreadable one without loading it", async () => {
    const one = await run(readAttachment, { ownerType: "transaction", ownerId: entryId, attachmentId: readableIds[1] });
    expect(one).toMatchObject({ loadedCount: 1, skippedCount: 0, attachments: [{ attachmentId: readableIds[1], originalName: "b.jpg", loaded: true }] });
    expect(out<{ attachmentId: string }[]>(one[TOOL_MEDIA_KEY]).map((m) => m.attachmentId)).toEqual([readableIds[1]]);

    const text = await run(readAttachment, { ownerType: "transaction", ownerId: entryId, attachmentId: unreadableId });
    expect(text).toMatchObject({ loadedCount: 0, skippedCount: 1, attachments: [{ attachmentId: unreadableId, loaded: false }] });
    expect(text[TOOL_MEDIA_KEY]).toEqual([]);
  });

  it("fails for an attachment that is not on that record, and for records of someone else or missing ones", async () => {
    const other2 = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 5, date: "2026-03-02", description: "Sem anexo" }, prisma)).entryIds[0];
    await expect(run(readAttachment, { ownerType: "transaction", ownerId: other2, attachmentId: readableIds[0] })).rejects.toThrow("Attachment not found on that record");
    expect(await run(readAttachment, { ownerType: "transaction", ownerId: other2 })).toMatchObject({ attachments: [], loadedCount: 0, skippedCount: 0 });

    const theirs = (await createEntry(OTHER, { kind: "expense", accountId: other.pfChecking, amount: 5, date: "2026-03-02", description: "Alheio" }, prisma)).entryIds[0];
    await prisma.attachment.create({ data: { kind: "RECEIPT", blobUrl: "blob://x", pathname: "x.png", mimeType: "image/png", sizeBytes: 1, originalName: "x.png", ledgerEntryId: theirs } });
    await expect(run(readAttachment, { ownerType: "transaction", ownerId: theirs })).rejects.toThrow("Entry not found or access denied");
    await expect(run(readAttachment, { ownerType: "transfer", ownerId: "missing-transfer" })).rejects.toThrow("Transfer not found or access denied");
  });

  it("reads the receipts of a transfer", async () => {
    const transfer = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 10, date: "2026-03-03", description: "Pix" }, prisma);
    await prisma.attachment.create({ data: { kind: "TRANSFER_RECEIPT", blobUrl: "blob://t.pdf", pathname: "t.pdf", mimeType: "application/pdf", sizeBytes: 1, originalName: "t.pdf", transferGroupId: transfer.transferGroupId } });
    const result = await run(readAttachment, { ownerType: "transfer", ownerId: transfer.transferGroupId! });
    expect(result).toMatchObject({ loadedCount: 1, attachments: [{ originalName: "t.pdf", kind: "TRANSFER_RECEIPT", loaded: true }] });
  });

  it("hands the files to the loop as media and keeps them out of the JSON summary", async () => {
    const result = await executeTool([readAttachment], ctx, "tool-1", "read_attachment", { ownerType: "transaction", ownerId: entryId, attachmentId: readableIds[0] });
    expect(result.isError).toBe(false);
    expect(result.media).toEqual([{ attachmentId: readableIds[0], originalName: "a.png", blobUrl: "blob://a.png", mediaType: "image/png" }]);
    expect(result.output).not.toHaveProperty(TOOL_MEDIA_KEY);
    expect(result.output).toMatchObject({ loadedCount: 1 });
    // A read tool is not audited.
    expect(await prisma.agentAction.count({ where: { conversationId: ctx.conversationId, toolName: "read_attachment" } })).toBe(0);
  });
});

describe("reconcile_statement", () => {
  let fileId: string;
  let dupEntry: string;
  let changedEntry: string;
  let fuzzyEntry: string;

  // As parseStatementFile stores them: the amount is the magnitude, the type carries the direction.
  const row = (fitId: string, date: string, description: string, signedAmount: number, fullDescription = description) => ({
    fitId,
    date,
    description,
    fullDescription,
    amount: Math.abs(signedAmount),
    type: signedAmount < 0 ? ("expense" as const) : ("income" as const),
  });

  beforeAll(async () => {
    await prisma.account.update({ where: { id: f.pfChecking }, data: { initialBalance: 3000 } });
    const make = async (input: Parameters<typeof createEntry>[1]) => (await createEntry(USER, input, prisma)).entryIds[0];
    dupEntry = await make({ kind: "expense", accountId: f.pfChecking, amount: 100, date: "2026-07-10", description: "Mercado A", externalId: "FIT-DUP" });
    changedEntry = await make({ kind: "expense", accountId: f.pfChecking, amount: 60, date: "2026-07-11", description: "Luz", externalId: "FIT-CHG" });
    fuzzyEntry = await make({ kind: "income", accountId: f.pfChecking, amount: 200, date: "2026-07-12", description: "Venda manual" });
    const known = await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 50, date: "2026-07-13", description: "Aporte antigo" }, prisma);
    await prisma.transferGroup.update({ where: { id: known.transferGroupId! }, data: { externalId: "FIT-KNOWN" } });

    const pix = "Transferência enviada pelo Pix - Kodama LTDA - 12.345.678/0001-90";
    fileId = (
      await addFile("julho.ofx", "ofx", {
        statementKind: "bank_ofx",
        parseStatus: "parsed",
        parsedPayload: {
          kind: "bank_ofx",
          bankName: "Nu Pagamentos S.A.",
          accountId: "1",
          currency: "BRL",
          ledgerBalance: 1215.5,
          balanceDate: "2026-07-31",
          dateStart: "2026-07-01",
          dateEnd: "2026-07-31",
          rows: [
            row("FIT-DUP", "2026-07-10", "Mercado A", -100),
            row("FIT-CHG", "2026-07-11", "Luz", -65),
            row("FIT-FUZZY", "2026-07-14", "Venda de garagem", 200),
            row("FIT-KNOWN", "2026-07-13", "Aporte antigo", -50),
            row("FIT-CARD", "2026-07-15", "Pagamento de fatura", -800),
            row("FIT-RDB", "2026-07-16", "Aplicação RDB", -500),
            row("FIT-PIX", "2026-07-17", "Pix para PJ", -300, pix),
            row("FIT-BOTH", "2026-07-18", "Pagamento de fatura Pix", -150, pix),
            row("FIT-NEW", "2026-07-19", "Cafe", -20),
          ],
        },
      })
    ).id;
  });

  it("classifies every statement row against the ledger and balances the statement", async () => {
    const result = out<{
      rows: {
        fitId: string;
        status: string;
        date: string;
        amount: number;
        existingTransactionId?: string;
        diffs?: { field: string; existingValue: string; ofxValue: string }[];
        fuzzyMatchedTransaction?: { id: string; description: string };
        candidates: { type: string; confidence: string }[];
        resolvedClassification?: string;
        needsResolution: boolean;
      }[];
      summary: unknown;
      balance: unknown;
    }>(await run(reconcileStatement, { fileId, entityType: "personal", entityId: f.pfId }));
    const byFit = Object.fromEntries(result.rows.map((r) => [r.fitId, r]));
    expect(result.rows.map((r) => r.fitId)).toHaveLength(9);

    expect(byFit["FIT-DUP"]).toMatchObject({ status: "duplicate", existingTransactionId: dupEntry, date: "2026-07-10", amount: 100 });
    // Duplicates are never classified: they default to a regular transaction that needs no decision.
    expect(byFit["FIT-DUP"]).toMatchObject({ candidates: [{ type: "regular_transaction", confidence: "high" }], needsResolution: false });
    expect(byFit["FIT-DUP"].resolvedClassification).toBeUndefined();

    expect(byFit["FIT-CHG"]).toMatchObject({ status: "changed", existingTransactionId: changedEntry });
    expect(byFit["FIT-CHG"].diffs).toEqual([{ field: "amount", existingValue: "60.00", ofxValue: "65.00" }]);

    expect(byFit["FIT-FUZZY"]).toMatchObject({ status: "fuzzy_match", fuzzyMatchedTransaction: { id: fuzzyEntry, description: "Venda manual", amount: 200 } });
    expect(byFit["FIT-KNOWN"].status).toBe("duplicate");

    expect(byFit["FIT-CARD"]).toMatchObject({ status: "new", resolvedClassification: "credit_card_payment", needsResolution: false });
    expect(byFit["FIT-CARD"].candidates[0]).toMatchObject({ type: "credit_card_payment", confidence: "high", creditCardDetails: { suggestedBankName: "Nu Pagamentos", dueDay: 15, closingDay: 5 } });
    expect(byFit["FIT-RDB"]).toMatchObject({ resolvedClassification: "investment_transfer" });
    expect(byFit["FIT-RDB"].candidates[0]).toMatchObject({ type: "investment_transfer", investmentDetails: { direction: "investment_deposit", suggestedAccountId: f.broker } });
    expect(byFit["FIT-PIX"]).toMatchObject({ resolvedClassification: "entity_transfer", needsResolution: false });
    expect(byFit["FIT-PIX"].candidates[0]).toMatchObject({ type: "entity_transfer", transferDetails: { suggestedEntityId: f.pjId, suggestedEntityName: "Kodama LTDA", suggestedEntityType: "business", suggestedFlow: "outflow", suggestedDirection: "capital_injection" } });

    // Two competing readings: the model must ask the user.
    expect(byFit["FIT-BOTH"].needsResolution).toBe(true);
    expect(byFit["FIT-BOTH"].resolvedClassification).toBeUndefined();
    expect(byFit["FIT-BOTH"].candidates.map((c) => c.type)).toEqual(["credit_card_payment", "entity_transfer", "regular_transaction"]);

    expect(byFit["FIT-NEW"]).toMatchObject({ status: "new", resolvedClassification: "regular_transaction", needsResolution: false, candidates: [{ type: "regular_transaction", confidence: "high" }] });

    expect(result.summary).toEqual({ new: 5, duplicate: 2, changed: 1, fuzzyMatch: 1, needsResolution: 1 });
    // 3000 opening + 200 income - (100 + 65 + 50 + 800 + 500 + 300 + 150 + 20) expenses = 1215 against a 1215.50 statement.
    expect(result.balance).toEqual({ computedBalance: 1215, ledgerBalance: 1215.5, discrepancy: 0.5, isBalanced: false });
  });

  it("reads money coming in from a business as a profit distribution", async () => {
    const inbound = await addFile("pro-labore.ofx", "ofx", {
      statementKind: "bank_ofx",
      parseStatus: "parsed",
      parsedPayload: {
        kind: "bank_ofx",
        bankName: "Itau",
        accountId: "2",
        currency: "BRL",
        ledgerBalance: 2000,
        balanceDate: "2026-08-31",
        dateStart: "2026-08-01",
        dateEnd: "2026-08-31",
        rows: [row("IN-1", "2026-08-05", "Pro-labore", 2000, "Transferência Recebida - Kodama LTDA - 12.345.678/0001-90")],
      },
    });
    const result = out<{ rows: { candidates: { type: string; transferDetails?: { suggestedFlow: string; suggestedDirection: string } }[]; resolvedClassification: string }[]; balance: unknown }>(
      await run(reconcileStatement, { fileId: inbound.id, entityType: "personal", entityId: f.pfId })
    );
    expect(result.rows[0].resolvedClassification).toBe("entity_transfer");
    expect(result.rows[0].candidates[0]).toMatchObject({ type: "entity_transfer", transferDetails: { suggestedFlow: "inflow", suggestedDirection: "profit_distribution" } });
    // The opening balance of 3000 plus the 2000 received is what the statement should close at, not 2000.
    expect(result.balance).toEqual({ computedBalance: 5000, ledgerBalance: 2000, discrepancy: -3000, isBalanced: false });
  });

  it("refuses anything but a parsed OFX of this conversation, for an entity of the user", async () => {
    const csv = await addFile("cartao.csv", "csv", { parseStatus: "parsed", parsedPayload: { kind: "card_csv", rows: [] } });
    const failed = await addFile("falhou.ofx", "ofx", { parseStatus: "failed", parseError: "xml quebrado" });
    const noPayload = await addFile("sem-payload.ofx", "ofx", { parseStatus: "parsed" });

    await expect(run(reconcileStatement, { fileId: "missing-file", entityType: "personal", entityId: f.pfId })).rejects.toThrow("File not found in this conversation");
    await expect(run(reconcileStatement, { fileId: csv.id, entityType: "personal", entityId: f.pfId })).rejects.toThrow("reconcile_statement only supports OFX files");
    await expect(run(reconcileStatement, { fileId: failed.id, entityType: "personal", entityId: f.pfId })).rejects.toThrow("File is not parsed (status: failed)");
    await expect(run(reconcileStatement, { fileId: noPayload.id, entityType: "personal", entityId: f.pfId })).rejects.toThrow("File is not parsed (status: parsed)");
    await expect(run(reconcileStatement, { fileId, entityType: "personal", entityId: other.pfId })).rejects.toThrow("personal entity not found or access denied");
    await expect(run(reconcileStatement, { fileId, entityType: "business", entityId: f.pfId })).rejects.toThrow("business entity not found or access denied");
  });
});

describe("search tools", () => {
  beforeAll(async () => {
    const make = (input: Parameters<typeof createEntry>[1], opts: Parameters<typeof createEntry>[3] = {}) => createEntry(USER, input, prisma, opts);
    await make({ kind: "expense", accountId: f.pfChecking, amount: 250, date: "2026-10-05", description: "Aluguel outubro", categoryId: f.categories.Groceries, externalId: "rent-oct" });
    await make({ kind: "expense", accountId: f.pfChecking, amount: 30, date: "2026-10-20", description: "Aluguel de bicicleta", externalId: "bike" });
    await make({ kind: "income", accountId: f.pfChecking, amount: 3000, date: "2026-10-25", description: "Freela", categoryId: f.categories.Salary });
    const t = await make({ kind: "transfer", fromAccountId: f.pfChecking, toAccountId: f.pjChecking, amount: 400, date: "2026-10-12", description: "Pro-labore" });
    await prisma.transferGroup.update({ where: { id: t.transferGroupId! }, data: { externalId: "ext-pl" } });
    await importCardStatement(
      USER,
      {
        accountId: f.card,
        month: "2026-10",
        fallback: "none",
        rows: [
          { date: "2026-09-30", description: "SPOTIFY", amount: 21.9, category: "Software" },
          { date: "2026-10-03", description: "RESTAURANTE", amount: 88.1, category: "Groceries" },
        ],
      },
      prisma
    );
  });

  it("search_transactions maps entries to date strings and receipts count, honouring every filter", async () => {
    const result = await run(searchTransactions, { entityType: "personal", type: "expense", dateFrom: "2026-10-01", dateTo: "2026-10-31", descriptionContains: "aluguel", amountMin: 10, amountMax: 300, limit: 5, offset: 0 });
    expect(result.total).toBe(2);
    expect(out<unknown[]>(result.rows)).toEqual([
      expect.objectContaining({ date: "2026-10-20", description: "Aluguel de bicicleta", amount: 30, type: "expense", category: null, externalId: "bike", statementImportId: null, attachmentCount: 0 }),
      expect.objectContaining({ date: "2026-10-05", description: "Aluguel outubro", amount: 250, category: "Groceries", externalId: "rent-oct" }),
    ]);
    expect(Object.keys((result.rows as object[])[0]).sort()).toEqual(["amount", "attachmentCount", "category", "date", "description", "externalId", "id", "statementImportId", "type"]);

    const byExternal = await run(searchTransactions, { externalIds: ["bike"] });
    expect(byExternal.total).toBe(1);
    expect(out<{ description: string }[]>(byExternal.rows)[0].description).toBe("Aluguel de bicicleta");
    expect((await run(searchTransactions, { externalIds: ["bike"], dateFrom: "2026-10-21" })).total).toBe(0);
  });

  it("search_transactions defaults to a page of 50", async () => {
    expect(searchTransactions.inputSchema.parse({}).limit).toBe(50);
    expect(searchTransactions.inputSchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(searchTransactions.inputSchema.safeParse({ externalIds: Array.from({ length: 101 }, (_, i) => String(i)) }).success).toBe(false);
  });

  it("search_transfers reports each transfer's sides and filters by date and external id", async () => {
    const result = await run(searchTransfers, { entityType: "business", dateFrom: "2026-10-01", dateTo: "2026-10-31", externalIds: ["ext-pl"], limit: 10, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.rows).toEqual([
      {
        id: expect.any(String),
        date: "2026-10-12",
        description: "Pro-labore",
        amount: 400,
        direction: "capital_injection",
        externalId: "ext-pl",
        fromBusinessId: null,
        fromPersonalAccountId: f.pfId,
        fromInvestmentAccountId: null,
        toBusinessId: f.pjId,
        toPersonalAccountId: null,
        toInvestmentAccountId: null,
      },
    ]);
    expect((await run(searchTransfers, { dateFrom: "2026-10-13" })).total).toBe(0);
    expect((await run(searchTransfers, { dateFrom: "2026-10-01", dateTo: "2026-10-11" })).total).toBe(0);
  });

  it("search_bill_transactions returns the card purchases with their category breakdown", async () => {
    const result = await run(searchBillTransactions, { dateFrom: "2026-09-30", dateTo: "2026-10-03", limit: 10 });
    expect(result.total).toBe(2);
    expect(result.byCategory).toEqual([
      { category: "Groceries", totalAmount: 88.1, count: 1 },
      { category: "Software", totalAmount: 21.9, count: 1 },
    ]);
    expect(out<unknown[]>(result.rows)).toEqual([
      expect.objectContaining({ date: "2026-10-03", description: "RESTAURANTE", amount: 88.1, category: "Groceries", installmentNumber: null, totalInstallments: null, merchantName: null }),
      expect.objectContaining({ date: "2026-09-30", description: "SPOTIFY", amount: 21.9, category: "Software" }),
    ]);
    expect((await run(searchBillTransactions, { creditCardId: f.card, category: "Software", descriptionContains: "spot" })).total).toBe(1);
    expect((await run(searchBillTransactions, { dateFrom: "2026-10-04" })).total).toBe(0);
  });
});

describe("list_credit_card_bills", () => {
  let overdueId: string;
  let pendingId: string;
  let paidId: string;
  let secondCard: string;

  beforeAll(async () => {
    secondCard = (await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "credit_card", name: "Inter", institution: "Banco Inter", currency: "BRL", externalId: "4321", creditLimit: 1000, closingDay: 10, dueDay: 17 } })).id;
    const overdue = await importCardStatement(USER, { accountId: f.card, month: "2024-01", closingDate: "2024-01-05", dueDate: "2024-01-12", fallback: "none", rows: [{ date: "2023-12-20", description: "ANTIGA", amount: 70, category: "Software" }, { date: "2023-12-21", description: "SEM CAT", amount: 30 }] }, prisma);
    overdueId = overdue.statementId;
    const pending = await importCardStatement(USER, { accountId: f.card, month: "2099-01", closingDate: "2099-01-05", dueDate: "2099-01-12", total: 555.55, fallback: "none", rows: [{ date: "2098-12-20", description: "FUTURA", amount: 10, category: "Groceries" }] }, prisma);
    pendingId = pending.statementId;
    const paid = await importCardStatement(USER, { accountId: secondCard, month: "2024-03", closingDate: "2024-03-10", dueDate: "2024-03-17", fallback: "none", rows: [{ date: "2024-02-20", description: "PAGA", amount: 45, category: "Groceries" }, { date: "2024-02-25", description: "PARCELA", amount: 20, category: "Groceries", installment: { number: 1, total: 2 } }] }, prisma);
    paidId = paid.statementId;
    const payment = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 65, date: "2024-03-17", description: "Pgto fatura Inter" }, prisma)).entryIds[0];
    const { markStatementPayment } = await import("@capital/server/modules/ledger/services/statements");
    await markStatementPayment(USER, payment, paidId, prisma);
  });

  const list = async (input: unknown = {}) => out<{ bills: { id: string; status: string; month: string; totalAmount: number; transactionCount: number; uncategorizedCount: number; transactionId: string | null; creditCard: unknown; closingDate: string | null; dueDate: string | null }[] }>(await run(listCreditCardBills, input)).bills;

  it("derives each bill's status, totals and uncategorized count from the card ledger", async () => {
    const bills = await list();
    const byId = Object.fromEntries(bills.map((b) => [b.id, b]));

    expect(byId[overdueId]).toMatchObject({
      month: "2024-01",
      status: "overdue",
      totalAmount: 100,
      transactionCount: 2,
      uncategorizedCount: 1,
      closingDate: "2024-01-05",
      dueDate: "2024-01-12",
      transactionId: null,
      creditCard: { id: f.card, bankName: "Nubank", lastFourDigits: "1234", nickname: "Nubank" },
    });
    // A bill with a stated total reports it; the 2098 purchase is the only booked row.
    expect(byId[pendingId]).toMatchObject({ month: "2099-01", status: "pending", totalAmount: 555.55, transactionCount: 1, uncategorizedCount: 0 });
    // Paid wins over the due date; projected installments are not purchases; the payment leg is the checking side.
    expect(byId[paidId]).toMatchObject({ month: "2024-03", status: "paid", totalAmount: 65, transactionCount: 2, creditCard: { id: secondCard, bankName: "Banco Inter", lastFourDigits: "4321", nickname: "Inter" } });
    expect(byId[paidId].transactionId).toEqual(expect.any(String));
    const paymentLeg = await prisma.ledgerEntry.findUniqueOrThrow({ where: { id: byId[paidId].transactionId! } });
    expect(paymentLeg.accountId).toBe(f.pfChecking);

    const months = bills.map((b) => b.month);
    expect(months).toEqual([...months].sort().reverse());
  });

  it("filters by card and by status", async () => {
    const ofCard = async (creditCardId: string) => (await list({ creditCardId })).map((b) => b.id);
    // The installment on the paid bill also opened next month's statement, which holds only its projection.
    const ofSecond = await list({ creditCardId: secondCard });
    expect(ofSecond.map((b) => b.month)).toEqual(["2024-04", "2024-03"]);
    expect(ofSecond[1].id).toBe(paidId);
    expect(ofSecond[0]).toMatchObject({ transactionCount: 0, uncategorizedCount: 0, transactionId: null });
    expect(ofSecond[0].totalAmount).toBeCloseTo(0);
    expect(await ofCard(f.card)).toEqual(expect.arrayContaining([overdueId, pendingId]));
    expect(await ofCard(f.card)).not.toContain(paidId);
    expect(await ofCard(other.card)).toEqual([]);

    // Statements from the search tests above (October 2026) are past due too.
    const overdue = await list({ status: "overdue" });
    expect(overdue.map((b) => b.id)).toContain(overdueId);
    expect(overdue.every((b) => b.status === "overdue")).toBe(true);
    expect(overdue.map((b) => b.id)).not.toContain(pendingId);

    expect((await list({ status: "paid" })).map((b) => b.id)).toEqual([paidId]);

    const pending = await list({ status: "pending" });
    expect(pending.map((b) => b.id)).toContain(pendingId);
    expect(pending.every((b) => b.status === "pending")).toBe(true);
    expect(pending.map((b) => b.id)).not.toContain(overdueId);
  });

  it("calls a bill without a due date pending", async () => {
    await prisma.cardStatement.update({ where: { id: overdueId }, data: { dueDate: null } });
    const bill = (await list({ creditCardId: f.card })).find((b) => b.id === overdueId)!;
    expect(bill).toMatchObject({ status: "pending", dueDate: null });
  });
});
