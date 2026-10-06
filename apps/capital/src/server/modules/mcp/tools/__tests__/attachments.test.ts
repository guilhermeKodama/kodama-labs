import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { MAX_FILE_SIZE_BYTES } from "../../../attachments/constants";
import { attachReceipt, deleteAttachment, listTransactionAttachments } from "../attachments";

const USER = "test-user-mcp-attachments-001";
const OTHER = "test-user-mcp-attachments-002";
const MISSING = "00000000-0000-0000-0000-000000000000";
const PDF = Buffer.from("%PDF-1.4\n%test receipt\n").toString("base64");
let f: LedgerFixture;
let transactionId: string;
let otherTransactionId: string;

beforeEach(async () => {
  f = await createLedgerFixture(prisma, USER);
  const other = await createLedgerFixture(prisma, OTHER);
  transactionId = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 100, date: "2026-10-01", description: "receipt" }, prisma)).entryIds[0];
  otherTransactionId = (await createEntry(OTHER, { kind: "expense", accountId: other.pfChecking, amount: 50, date: "2026-10-01", description: "other" }, prisma)).entryIds[0];
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

const receipt = (overrides: Record<string, unknown> = {}) => ({ transactionId, filename: "receipt.pdf", mimeType: "application/pdf", contentBase64: PDF, ...overrides });

describe("attach_receipt", () => {
  it("attaches PDFs and images to an entry", async () => {
    const pdf = await attachReceipt(USER, receipt(), prisma);
    expect(pdf).toMatchObject({ filename: "receipt.pdf", mimeType: "application/pdf" });
    const jpeg = await attachReceipt(USER, receipt({ filename: "r.jpg", mimeType: "image/jpeg", contentBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]).toString("base64") }), prisma);
    expect(jpeg.mimeType).toBe("image/jpeg");
    const rows = await prisma.attachment.findMany({ where: { ledgerEntryId: transactionId } });
    expect(rows.map((r) => r.kind)).toEqual(["RECEIPT", "RECEIPT"]);
  });

  it("accepts files up to the limit and rejects bigger ones", async () => {
    const big = Buffer.alloc(MAX_FILE_SIZE_BYTES - 1024, 1).toString("base64");
    await expect(attachReceipt(USER, receipt({ contentBase64: big }), prisma)).resolves.toBeTruthy();
    const tooBig = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1024, 1).toString("base64");
    await expect(attachReceipt(USER, receipt({ contentBase64: tooBig }), prisma)).rejects.toThrow(/exceeds maximum/);
  }, 30_000);

  it("rejects foreign or unknown entries, bad mime types and bad base64", async () => {
    await expect(attachReceipt(USER, receipt({ transactionId: otherTransactionId }), prisma)).rejects.toThrow(/not found or access denied/);
    await expect(attachReceipt(USER, receipt({ transactionId: MISSING }), prisma)).rejects.toThrow(/not found or access denied/);
    await expect(attachReceipt(USER, receipt({ mimeType: "text/plain" }), prisma)).rejects.toThrow(/not allowed/);
    await expect(attachReceipt(USER, receipt({ contentBase64: "not base64!!" }), prisma)).rejects.toThrow(/Invalid base64/);
  });
});

describe("list_attachments / delete_attachment", () => {
  it("lists an entry's attachments and deletes them", async () => {
    expect((await listTransactionAttachments(USER, { transactionId }, prisma)).attachments).toEqual([]);
    const a = await attachReceipt(USER, receipt(), prisma);
    const listed = await listTransactionAttachments(USER, { transactionId }, prisma);
    expect(listed.attachments.map((x) => [x.id, x.kind])).toEqual([[a.id, "RECEIPT"]]);
    expect(await deleteAttachment(USER, { attachmentId: a.id }, prisma)).toEqual({ success: true, attachmentId: a.id });
    expect(await prisma.attachment.count({ where: { id: a.id } })).toBe(0);
  });

  it("rejects other users and unknown attachments", async () => {
    await expect(listTransactionAttachments(USER, { transactionId: otherTransactionId }, prisma)).rejects.toThrow(/not found/);
    const a = await attachReceipt(USER, receipt(), prisma);
    await expect(deleteAttachment(OTHER, { attachmentId: a.id }, prisma)).rejects.toThrow(/not found/);
    await expect(deleteAttachment(USER, { attachmentId: MISSING }, prisma)).rejects.toThrow(/not found/);
  });
});
