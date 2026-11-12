import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { LedgerError } from "@capital/server/modules/ledger/lib/errors";
import { MAX_IMAGE_FILE_BYTES, MAX_STATEMENT_FILE_BYTES } from "../../constants";
import { uploadConversationFile } from "../upload-conversation-file";

/**
 * uploadConversationFile against the real database, with the blob store
 * replaced by a recorder: what is stored (path, bytes, content type), what
 * is parsed, and which uploads are refused before anything is written.
 */

const blob = vi.hoisted(() => ({
  putObject: vi
    .fn<(pathname: string, body: Buffer, contentType: string) => Promise<{ url: string; pathname: string }>>()
    .mockImplementation(async (pathname) => ({ url: `https://blob.test/${pathname}`, pathname })),
}));

vi.mock("@/lib/storage", () => ({ putObject: blob.putObject }));

const OWNER = "test-user-assistant-upload-001";
const STRANGER = "test-user-assistant-upload-002";

const OFX = [
  "OFXHEADER:100",
  "<OFX><SIGNONMSGSRSV1><SONRS><FI><ORG>NU PAGAMENTOS</ORG></FI></SONRS></SIGNONMSGSRSV1>",
  "<BANKMSGSRSV1><STMTTRNRS><STMTRS><CURDEF>BRL",
  "<BANKACCTFROM><BANKID>0260<ACCTID>1<ACCTTYPE>CHECKING</BANKACCTFROM>",
  "<BANKTRANLIST><DTSTART>20260101<DTEND>20260131",
  "<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260110<TRNAMT>-10.00<FITID>fit-1<MEMO>Compra no débito - LOJA</STMTTRN>",
  "</BANKTRANLIST><LEDGERBAL><BALAMT>90.00<DTASOF>20260131</LEDGERBAL>",
  "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
].join("\n");
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32)]);
const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(32)]);

let conversationId: string;
let strangerConversationId: string;

async function createUser(id: string) {
  await prisma.user.deleteMany({ where: { id } });
  await prisma.user.create({ data: { id, email: `${id}@example.com`, passwordHash: "x", name: id } });
}

const upload = (file: { buffer: Buffer; mimeType: string; originalName: string }, userId = OWNER, id = conversationId) =>
  uploadConversationFile(userId, { conversationId: id, file }, prisma);

const storedPath = () => blob.putObject.mock.calls.at(-1)![0];
const countFiles = (id: string) => prisma.conversationFile.count({ where: { conversationId: id } });

beforeAll(async () => {
  await createUser(OWNER);
  await createUser(STRANGER);
  conversationId = (await prisma.agentConversation.create({ data: { userId: OWNER, title: "Upload" }, select: { id: true } })).id;
  strangerConversationId = (await prisma.agentConversation.create({ data: { userId: STRANGER, title: "Outra" }, select: { id: true } })).id;
});

beforeEach(async () => {
  blob.putObject.mockClear();
  await prisma.conversationFile.deleteMany({ where: { conversationId: { in: [conversationId, strangerConversationId] } } });
});

afterAll(async () => {
  // Cascades the conversations and their files.
  await prisma.user.deleteMany({ where: { id: { in: [OWNER, STRANGER] } } });
});

describe("a bank OFX", () => {
  it("is stored under the conversation, parsed, and saved with its parsed rows", async () => {
    const buffer = Buffer.from(OFX);

    const file = await upload({ buffer, mimeType: "text/plain", originalName: "Extrato de Janeiro.OFX" });

    expect(blob.putObject).toHaveBeenCalledTimes(1);
    const [pathname, body, contentType] = blob.putObject.mock.calls[0]!;
    expect(pathname).toMatch(new RegExp(`^capital/conversations/${conversationId}/[0-9a-f-]{36}-extrato-de-janeiro\\.ofx$`));
    expect(body).toBe(buffer);
    expect(contentType).toBe("text/plain");

    const row = await prisma.conversationFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row).toMatchObject({
      conversationId,
      userId: OWNER,
      fileType: "ofx",
      statementKind: "bank_ofx",
      blobUrl: `https://blob.test/${pathname}`,
      pathname,
      // The declared type stands for non-images.
      mimeType: "text/plain",
      sizeBytes: buffer.byteLength,
      originalName: "Extrato de Janeiro.OFX",
      parseStatus: "parsed",
      parseError: null,
    });
    expect(row.parsedPayload).toMatchObject({
      kind: "bank_ofx",
      bankName: "NU PAGAMENTOS",
      currency: "BRL",
      rows: [{ fitId: "fit-1", date: "2026-01-10", amount: 10, type: "expense" }],
    });
  });

  it("is kept with a failed parse, and its error, when the statement cannot be read", async () => {
    const file = await upload({ buffer: Buffer.from("OFXHEADER:100\n<OFX></OFX>"), mimeType: "application/octet-stream", originalName: "quebrado.ofx" });

    const row = await prisma.conversationFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row).toMatchObject({ fileType: "ofx", parseStatus: "failed", parseError: "No STMTRS block found in OFX file", parsedPayload: null });
  });
});

describe("a card bill", () => {
  it("is parsed from a CSV into card_csv rows", async () => {
    const csv = "data,descricao,valor\n2026-09-01,Mercado,120.50\n2026-09-03,Pagamento recebido,-500.00\n";

    const file = await upload({ buffer: Buffer.from(csv), mimeType: "text/csv", originalName: "fatura.csv" });

    expect(file).toMatchObject({ fileType: "csv", statementKind: "card_csv", parseStatus: "parsed", mimeType: "text/csv" });
    expect(file.parsedPayload).toMatchObject({
      kind: "card_csv",
      rows: [
        { date: "2026-09-01", description: "Mercado", amount: 120.5, isPayment: false },
        { date: "2026-09-03", description: "Pagamento recebido", amount: -500, isPayment: true },
      ],
    });
  });
});

describe("files the model reads itself", () => {
  it("stores a PDF without parsing it, and allows it above the image limit", async () => {
    const big = Buffer.concat([PDF, Buffer.alloc(MAX_IMAGE_FILE_BYTES + 1)]);

    const file = await upload({ buffer: big, mimeType: "application/pdf", originalName: "nota-de-corretagem.pdf" });

    expect(file).toMatchObject({
      fileType: "pdf",
      statementKind: "investment_pdf",
      parseStatus: "not_applicable",
      parsedPayload: null,
      sizeBytes: big.byteLength,
      mimeType: "application/pdf",
    });
  });

  it("stores an image with the type sniffed from its bytes, not the one the browser declared", async () => {
    const file = await upload({ buffer: PNG, mimeType: "application/octet-stream", originalName: "Captura de tela 2026.png" });

    expect(file).toMatchObject({ fileType: "image", statementKind: "image", mimeType: "image/png", parseStatus: "not_applicable" });
    // The type given to the blob store is still the declared one.
    expect(blob.putObject.mock.calls[0]![2]).toBe("application/octet-stream");
    expect(storedPath()).toMatch(/-captura-de-tela-2026\.png$/);
  });
});

describe("what is refused", () => {
  async function refusal(promise: Promise<unknown>) {
    const error = await promise.then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(LedgerError);
    return error as LedgerError;
  }

  it("refuses a statement over the size limit before storing anything", async () => {
    const error = await refusal(
      upload({ buffer: Buffer.alloc(MAX_STATEMENT_FILE_BYTES + 1), mimeType: "text/csv", originalName: "enorme.csv" })
    );

    expect(error).toMatchObject({ status: 422, code: "assistant.file_too_large", params: { maxBytes: MAX_STATEMENT_FILE_BYTES } });
    expect(blob.putObject).not.toHaveBeenCalled();
    expect(await countFiles(conversationId)).toBe(0);
  });

  it("refuses an image over the image limit, which is tighter than the statement limit", async () => {
    const error = await refusal(
      upload({ buffer: Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_FILE_BYTES)]), mimeType: "image/png", originalName: "grande.png" })
    );

    expect(error).toMatchObject({ status: 422, code: "assistant.image_too_large", params: { maxBytes: MAX_IMAGE_FILE_BYTES } });
    expect(blob.putObject).not.toHaveBeenCalled();
    expect(await countFiles(conversationId)).toBe(0);
  });

  it("accepts an image exactly at the image limit", async () => {
    const buffer = Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_FILE_BYTES - PNG.byteLength)]);
    expect(buffer.byteLength).toBe(MAX_IMAGE_FILE_BYTES);

    const file = await upload({ buffer, mimeType: "image/png", originalName: "no-limite.png" });

    expect(file.sizeBytes).toBe(MAX_IMAGE_FILE_BYTES);
  });

  it("refuses a file that is neither OFX, CSV, PDF nor an image", async () => {
    const error = await refusal(upload({ buffer: Buffer.from("só um texto"), mimeType: "text/plain", originalName: "notas.txt" }));

    expect(error).toMatchObject({ status: 422, code: "assistant.file_type_unsupported" });
    expect(blob.putObject).not.toHaveBeenCalled();
    expect(await countFiles(conversationId)).toBe(0);
  });

  it("refuses to attach a file to the conversation of another user, and saves no row", async () => {
    const error = await refusal(upload({ buffer: Buffer.from(OFX), mimeType: "text/plain", originalName: "extrato.ofx" }, OWNER, strangerConversationId));

    expect(error).toMatchObject({ status: 404, code: "assistant.conversation_not_found" });
    expect(await countFiles(strangerConversationId)).toBe(0);
  });

  it("refuses a conversation that does not exist", async () => {
    const error = await refusal(
      upload({ buffer: Buffer.from(OFX), mimeType: "text/plain", originalName: "extrato.ofx" }, OWNER, "00000000-0000-0000-0000-000000000000")
    );
    expect(error).toMatchObject({ status: 404, code: "assistant.conversation_not_found" });
  });
});

describe("the stored file name", () => {
  const ofx = () => Buffer.from(OFX);

  it("uses .bin when the original name has no extension", async () => {
    await upload({ buffer: ofx(), mimeType: "text/plain", originalName: "extrato" });
    expect(storedPath()).toMatch(/-extrato\.bin$/);
  });

  it("falls back to a generic slug when the name has nothing a slug can keep", async () => {
    await upload({ buffer: ofx(), mimeType: "text/plain", originalName: "###.ofx" });
    expect(storedPath()).toMatch(/-file\.ofx$/);
  });

  it("strips accents, lowercases, and keeps the slug at 60 characters", async () => {
    await upload({ buffer: ofx(), mimeType: "text/plain", originalName: `Ação ${"a".repeat(100)}.ofx` });
    const slug = storedPath().match(/^capital\/conversations\/[^/]+\/[0-9a-f-]{36}-(.+)\.ofx$/)![1]!;
    expect(slug).toBe(`acao-${"a".repeat(55)}`);
    expect(slug).toHaveLength(60);
  });

  it("gives two uploads of the same name two different paths", async () => {
    await upload({ buffer: ofx(), mimeType: "text/plain", originalName: "extrato.ofx" });
    await upload({ buffer: ofx(), mimeType: "text/plain", originalName: "extrato.ofx" });
    const [first, second] = blob.putObject.mock.calls.map((call) => call[0]);
    expect(first).not.toBe(second);
  });
});
