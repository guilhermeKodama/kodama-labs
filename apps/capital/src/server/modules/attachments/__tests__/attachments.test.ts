import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = vi.hoisted(() => ({ failDelete: false }));
vi.mock("@/lib/storage", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/storage")>();
  return { ...real, deleteObject: (url: string) => (storage.failDelete ? Promise.reject(new Error("blob store unreachable")) : real.deleteObject(url)) };
});

import { prisma } from "@capital/server/lib/prisma";
import { createApp } from "@capital/server/lib/create-app";
import { deleteObject, getObjectBuffer } from "@/lib/storage";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { MAX_FILE_SIZE_BYTES } from "../constants";
import { canReadBlob } from "../services/blob-access";
import { deleteAttachment, fromLegacyOwnerType, listAttachments, serializeAttachment, uploadAttachment, verifyOwnerAccess } from "../services/attachments";

const USER = "test-user-attachments-001";
const OTHER = "test-user-attachments-002";
const MISSING = "00000000-0000-0000-0000-000000000000";
const app = createApp();

let f: LedgerFixture;
let other: LedgerFixture;
let cookie: string;
let otherCookie: string;
let entryId: string;
let transferId: string;
let ruleId: string;
let otherEntryId: string;

const login = async (userId: string) => `capital_session=${(await prisma.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000) } })).id}`;

const PDF = "%PDF-1.4 recibo de teste";
const file = (content: BlobPart = PDF, name = "recibo.pdf", type = "application/pdf") => new File([content], name, { type });

async function upload(fields: { file?: File | null; kind?: string; ownerType?: string; ownerId?: string }, as: string | null = cookie) {
  const form = new FormData();
  if (fields.file !== null) form.set("file", fields.file ?? file());
  if (fields.kind !== undefined) form.set("kind", fields.kind);
  if (fields.ownerType !== undefined) form.set("ownerType", fields.ownerType);
  if (fields.ownerId !== undefined) form.set("ownerId", fields.ownerId);
  const res = await app.request("/api/v2/attachments", { method: "POST", headers: as ? { cookie: as } : {}, body: form });
  return { status: res.status, body: await res.json() };
}

async function json(method: string, path: string, as: string | null = cookie) {
  const res = await app.request(`/api${path}`, { method, headers: as ? { cookie: as } : {} });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  storage.failDelete = false;
  f = await createLedgerFixture(prisma, USER);
  other = await createLedgerFixture(prisma, OTHER);
  cookie = await login(USER);
  otherCookie = await login(OTHER);
  entryId = (await createEntry(USER, { kind: "expense", accountId: f.pfChecking, amount: 10, date: "2026-10-01", description: "Mercado" }, prisma)).entryIds[0]!;
  otherEntryId = (await createEntry(OTHER, { kind: "expense", accountId: other.pfChecking, amount: 5, date: "2026-10-01", description: "Alheio" }, prisma)).entryIds[0]!;
  const savings = await prisma.account.create({ data: { userId: USER, entityId: f.pfId, type: "cash", name: "Reserva", currency: "BRL" } });
  transferId = (await createEntry(USER, { kind: "transfer", fromAccountId: f.pfChecking, toAccountId: savings.id, amount: 20, date: "2026-10-02", description: "Reserva" }, prisma)).transferGroupId!;
  ruleId = (
    await prisma.recurringRule.create({
      data: {
        userId: USER,
        entityId: f.pfId,
        accountId: f.pfChecking,
        kind: "expense",
        amount: 100,
        currency: "BRL",
        description: "Aluguel",
        frequency: "monthly",
        startDate: new Date("2026-01-07T12:00:00Z"),
        nextDueDate: new Date("2026-11-07T12:00:00Z"),
        autoGenerate: false,
      },
    })
  ).id;
});

/** Deleting a user cascades the attachment rows but leaves their files in the blob directory: remove those. */
async function removeStoredFiles() {
  storage.failDelete = false;
  const users = { in: [USER, OTHER] };
  const rows = await prisma.attachment.findMany({ where: { OR: [{ ledgerEntry: { userId: users } }, { transferGroup: { userId: users } }, { recurringRule: { userId: users } }] } });
  for (const row of rows) await deleteObject(row.blobUrl);
}

afterEach(async () => {
  vi.restoreAllMocks();
  await removeStoredFiles();
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, USER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("POST /v2/attachments", () => {
  it("stores a bill, a receipt, a transfer receipt and a rule's bill, each on its owner, with the bytes in the blob store", async () => {
    const cases = [
      { kind: "RECEIPT", ownerType: "entry", ownerId: entryId, column: "ledgerEntryId" },
      { kind: "BILL", ownerType: "entry", ownerId: entryId, column: "ledgerEntryId" },
      { kind: "TRANSFER_RECEIPT", ownerType: "transfer", ownerId: transferId, column: "transferGroupId" },
      { kind: "BILL", ownerType: "recurring", ownerId: ruleId, column: "recurringRuleId" },
    ] as const;
    for (const { kind, ownerType, ownerId, column } of cases) {
      const { status, body } = await upload({ kind, ownerType, ownerId, file: file(`${PDF} ${kind}`, "Conta de Luz.PDF") });

      expect(status, `${kind} on ${ownerType}`).toBe(200);
      expect(body).toMatchObject({ kind, mimeType: "application/pdf", sizeBytes: Buffer.byteLength(`${PDF} ${kind}`), originalName: "Conta de Luz.PDF", [column]: ownerId });
      expect(body).not.toHaveProperty("pathname");
      const stored = await prisma.attachment.findUniqueOrThrow({ where: { id: body.id } });
      expect(stored[column]).toBe(ownerId);
      expect(stored.pathname).toMatch(new RegExp(`^capital/${ownerId}/${kind.toLowerCase()}/[0-9a-f-]{36}-conta-de-luz\\.pdf$`));
      expect((await getObjectBuffer(body.blobUrl))?.toString()).toBe(`${PDF} ${kind}`);
    }
    expect(await prisma.attachment.count({ where: { OR: [{ ledgerEntryId: entryId }, { transferGroupId: transferId }, { recurringRuleId: ruleId }] } })).toBe(4);
  });

  it("accepts images and files right up to the size limit, and refuses one byte more", async () => {
    for (const [content, name, type] of [[Buffer.from([0xff, 0xd8, 0xff, 0xe0]), "foto.jpg", "image/jpeg"], [Buffer.from([0x89, 0x50, 0x4e, 0x47]), "tela.png", "image/png"], [Buffer.from("RIFF"), "foto.webp", "image/webp"]] as const) {
      expect((await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId, file: file(content, name, type) })).status, type).toBe(200);
    }
    const exact = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId, file: file(Buffer.alloc(MAX_FILE_SIZE_BYTES, 1)) });
    expect(exact.status).toBe(200);
    expect(exact.body.sizeBytes).toBe(MAX_FILE_SIZE_BYTES);

    const before = await prisma.attachment.count({ where: { ledgerEntryId: entryId } });
    const over = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId, file: file(Buffer.alloc(MAX_FILE_SIZE_BYTES + 1, 1)) });
    expect(over).toMatchObject({ status: 422, body: { code: "attachment.too_large", params: { maxBytes: MAX_FILE_SIZE_BYTES } } });
    expect(await prisma.attachment.count({ where: { ledgerEntryId: entryId } })).toBe(before);
  }, 30_000);

  it("refuses a file type that is not allowed, and a kind that does not belong on that owner", async () => {
    const text = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId, file: file("oi", "nota.txt", "text/plain") });
    expect(text).toMatchObject({ status: 422, body: { code: "attachment.mime_not_allowed", params: { mimeType: "text/plain" } } });
    const noType = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId, file: file("oi", "nota.pdf", "") });
    expect(noType.body.code).toBe("attachment.mime_not_allowed");

    for (const [kind, ownerType, ownerId] of [["RECEIPT", "transfer", transferId], ["RECEIPT", "recurring", ruleId], ["BILL", "transfer", transferId], ["TRANSFER_RECEIPT", "entry", entryId]] as const) {
      const res = await upload({ kind, ownerType, ownerId });
      expect(res, `${kind} on ${ownerType}`).toMatchObject({ status: 422, body: { code: "attachment.kind_not_allowed", params: { kind, ownerType } } });
    }
    expect(await prisma.attachment.count({ where: { OR: [{ ledgerEntryId: entryId }, { transferGroupId: transferId }, { recurringRuleId: ruleId }] } })).toBe(0);
  });

  it("answers 404 for an owner that does not exist or is someone else's, and stores nothing", async () => {
    const missing = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: MISSING });
    expect(missing).toMatchObject({ status: 404, body: { code: "attachment.owner_not_found", params: { ownerType: "entry" } } });
    const foreign = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: otherEntryId });
    expect(foreign.status).toBe(404);
    expect((await upload({ kind: "TRANSFER_RECEIPT", ownerType: "transfer", ownerId: MISSING })).body.params).toEqual({ ownerType: "transfer" });
    expect((await upload({ kind: "BILL", ownerType: "recurring", ownerId: MISSING })).body.params).toEqual({ ownerType: "recurring" });
    expect(await prisma.attachment.count({ where: { ledgerEntryId: otherEntryId } })).toBe(0);
  });

  it("needs a file and the three fields", async () => {
    expect(await upload({ file: null, kind: "RECEIPT", ownerType: "entry", ownerId: entryId })).toMatchObject({ status: 400, body: { code: "attachment.file_required" } });
    // An owner id that is present but empty gets past the form schema and is refused by the handler.
    expect(await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: "" })).toMatchObject({ status: 400, body: { code: "attachment.fields_required" } });
    // The form schema rejects the rest before the handler runs.
    for (const fields of [
      { ownerType: "entry", ownerId: entryId },
      { kind: "RECEIPT", ownerId: entryId },
      { kind: "RECEIPT", ownerType: "entry" },
      { kind: "INVOICE", ownerType: "entry", ownerId: entryId },
      { kind: "RECEIPT", ownerType: "account", ownerId: entryId },
    ]) {
      expect(await upload(fields), JSON.stringify(fields)).toMatchObject({ status: 422, body: { code: "validation" } });
    }
    expect(await prisma.attachment.count({ where: { ledgerEntryId: entryId } })).toBe(0);
  });

  it("needs a session", async () => {
    expect((await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId }, null)).status).toBe(401);
  });
});

describe("GET /v2/attachments", () => {
  it("lists one owner's attachments oldest first, without the storage path", async () => {
    const first = await upload({ kind: "BILL", ownerType: "entry", ownerId: entryId, file: file("um", "um.pdf") });
    const second = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId, file: file("dois", "dois.pdf") });
    await prisma.attachment.update({ where: { id: first.body.id }, data: { uploadedAt: new Date("2026-10-02T00:00:00Z") } });
    await prisma.attachment.update({ where: { id: second.body.id }, data: { uploadedAt: new Date("2026-10-01T00:00:00Z") } });
    await upload({ kind: "BILL", ownerType: "recurring", ownerId: ruleId });

    const { status, body } = await json("GET", `/v2/attachments?ownerType=entry&ownerId=${entryId}`);

    expect(status).toBe(200);
    expect(body.attachments.map((row: { originalName: string }) => row.originalName)).toEqual(["dois.pdf", "um.pdf"]);
    expect(body.attachments[0]).toMatchObject({ id: second.body.id, kind: "RECEIPT", ledgerEntryId: entryId, transferGroupId: null, recurringRuleId: null });
    expect(body.attachments[0]).not.toHaveProperty("pathname");
  });

  it("lists every attachment of a type across the user's owners, and none of anyone else's", async () => {
    const mine = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId });
    const theirs = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: otherEntryId }, otherCookie);
    await upload({ kind: "TRANSFER_RECEIPT", ownerType: "transfer", ownerId: transferId });

    const entries = await json("GET", "/v2/attachments?ownerType=entry");
    expect(entries.body.attachments.map((row: { id: string }) => row.id)).toEqual([mine.body.id]);
    expect((await json("GET", "/v2/attachments?ownerType=entry", otherCookie)).body.attachments.map((row: { id: string }) => row.id)).toEqual([theirs.body.id]);
    expect((await json("GET", "/v2/attachments?ownerType=transfer")).body.attachments).toHaveLength(1);
    expect((await json("GET", "/v2/attachments?ownerType=recurring")).body.attachments).toEqual([]);
  });

  it("answers 404 for someone else's owner, and 422 for an unknown owner type", async () => {
    expect(await json("GET", `/v2/attachments?ownerType=entry&ownerId=${otherEntryId}`)).toMatchObject({ status: 404, body: { code: "attachment.owner_not_found" } });
    expect((await json("GET", "/v2/attachments?ownerType=account")).status).toBe(422);
    expect((await json("GET", "/v2/attachments")).status).toBe(422);
    expect((await json("GET", "/v2/attachments?ownerType=entry", null)).status).toBe(401);
  });
});

describe("DELETE /v2/attachments/:id", () => {
  it("removes the row and the stored file", async () => {
    const created = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId });
    expect((await getObjectBuffer(created.body.blobUrl))?.toString()).toBe(PDF);

    expect(await json("DELETE", `/v2/attachments/${created.body.id}`)).toEqual({ status: 200, body: { success: true } });

    expect(await prisma.attachment.count({ where: { id: created.body.id } })).toBe(0);
    expect(await getObjectBuffer(created.body.blobUrl)).toBeNull();
  });

  it("deletes the row even when the stored file cannot be removed, and says so in the log", async () => {
    const created = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: entryId });
    storage.failDelete = true;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect((await json("DELETE", `/v2/attachments/${created.body.id}`)).status).toBe(200);

    expect(await prisma.attachment.count({ where: { id: created.body.id } })).toBe(0);
    expect(warn).toHaveBeenCalledWith("Failed to delete blob for attachment", created.body.id, expect.objectContaining({ message: "blob store unreachable" }));
  });

  it("answers 404 for a missing attachment and for another user's, which stays", async () => {
    const theirs = await upload({ kind: "RECEIPT", ownerType: "entry", ownerId: otherEntryId }, otherCookie);
    expect(await json("DELETE", `/v2/attachments/${MISSING}`)).toMatchObject({ status: 404, body: { code: "attachment.not_found" } });
    expect(await json("DELETE", `/v2/attachments/${theirs.body.id}`)).toMatchObject({ status: 404, body: { code: "attachment.not_found" } });
    expect(await prisma.attachment.count({ where: { id: theirs.body.id } })).toBe(1);
    expect((await json("DELETE", `/v2/attachments/${theirs.body.id}`, null)).status).toBe(401);
  });
});

describe("attachment services", () => {
  it("maps the legacy owner types of the MCP and assistant contracts", () => {
    expect(fromLegacyOwnerType("transaction")).toBe("entry");
    expect(fromLegacyOwnerType("transfer")).toBe("transfer");
    expect(fromLegacyOwnerType("recurringTransaction")).toBe("recurring");
    expect(fromLegacyOwnerType("recurringTransfer")).toBe("recurring");
  });

  it("checks ownership for each owner type", async () => {
    await expect(verifyOwnerAccess(USER, "entry", entryId, prisma)).resolves.toBeUndefined();
    await expect(verifyOwnerAccess(USER, "transfer", transferId, prisma)).resolves.toBeUndefined();
    await expect(verifyOwnerAccess(USER, "recurring", ruleId, prisma)).resolves.toBeUndefined();
    await expect(verifyOwnerAccess(OTHER, "entry", entryId, prisma)).rejects.toMatchObject({ status: 404, code: "attachment.owner_not_found" });
    await expect(verifyOwnerAccess(OTHER, "transfer", transferId, prisma)).rejects.toMatchObject({ message: "Transfer not found or access denied" });
    await expect(verifyOwnerAccess(OTHER, "recurring", ruleId, prisma)).rejects.toMatchObject({ message: "Recurring rule not found or access denied" });
  });

  it("serializes an attachment with the ISO upload time and without the storage path", async () => {
    const created = await uploadAttachment(USER, { kind: "RECEIPT", ownerType: "entry", ownerId: entryId, file: { buffer: Buffer.from(PDF), mimeType: "application/pdf", originalName: "r.pdf" } }, prisma);
    const serialized = serializeAttachment(created);
    expect(serialized).toEqual({
      id: created.id,
      kind: "RECEIPT",
      mimeType: "application/pdf",
      sizeBytes: PDF.length,
      originalName: "r.pdf",
      uploadedAt: created.uploadedAt.toISOString(),
      ledgerEntryId: entryId,
      transferGroupId: null,
      recurringRuleId: null,
      blobUrl: created.blobUrl,
    });
    expect((await listAttachments(USER, "entry", entryId, prisma)).map((row) => row.id)).toEqual([created.id]);
    expect(await deleteAttachment(USER, created.id, prisma)).toMatchObject({ id: created.id });
  });
});

describe("canReadBlob", () => {
  it("lets the owner of an attachment or of an assistant file read it, and nobody else", async () => {
    const attachment = await uploadAttachment(USER, { kind: "RECEIPT", ownerType: "entry", ownerId: entryId, file: { buffer: Buffer.from(PDF), mimeType: "application/pdf", originalName: "r.pdf" } }, prisma);
    const conversation = await prisma.agentConversation.create({ data: { userId: USER, title: "Extrato" } });
    const assistantFile = await prisma.conversationFile.create({
      data: { conversationId: conversation.id, userId: USER, fileType: "pdf", blobUrl: "http://local/x", pathname: `capital/${USER}/assistant/extrato.pdf`, mimeType: "application/pdf", sizeBytes: 10, originalName: "extrato.pdf" },
    });

    expect(await canReadBlob(USER, attachment.pathname, prisma)).toBe(true);
    expect(await canReadBlob(OTHER, attachment.pathname, prisma)).toBe(false);
    expect(await canReadBlob(USER, assistantFile.pathname, prisma)).toBe(true);
    expect(await canReadBlob(OTHER, assistantFile.pathname, prisma)).toBe(false);
    expect(await canReadBlob(USER, "capital/nobody/receipt/missing.pdf", prisma)).toBe(false);
  });

  it("follows an attachment to its transfer and its recurring rule", async () => {
    const onTransfer = await uploadAttachment(USER, { kind: "TRANSFER_RECEIPT", ownerType: "transfer", ownerId: transferId, file: { buffer: Buffer.from("t"), mimeType: "application/pdf", originalName: "t.pdf" } }, prisma);
    const onRule = await uploadAttachment(USER, { kind: "BILL", ownerType: "recurring", ownerId: ruleId, file: { buffer: Buffer.from("b"), mimeType: "application/pdf", originalName: "b.pdf" } }, prisma);
    for (const row of [onTransfer, onRule]) {
      expect(await canReadBlob(USER, row.pathname, prisma)).toBe(true);
      expect(await canReadBlob(OTHER, row.pathname, prisma)).toBe(false);
    }
  });
});
