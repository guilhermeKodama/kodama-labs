import { describe, it, expect, beforeEach } from "vitest";
import {
  attachReceipt,
  listTransactionAttachments,
  deleteAttachment,
} from "../attachments";
import { prisma } from "@capital/server/lib/prisma";
import { MAX_FILE_SIZE_BYTES } from "../../../attachments/constants";

const db = prisma;

// Test user ID - unique per test file to avoid conflicts
const TEST_USER_ID = "test-user-mcp-attachments-001";
const OTHER_USER_ID = "test-user-mcp-attachments-002";

describe("MCP Attachment Tools", () => {
  let personalAccountId: string;
  let transactionId: string;
  let otherUserTransactionId: string;

  beforeEach(async () => {
    // Clean up any existing test data first
    await db.attachment.deleteMany({
      where: {
        OR: [
          { transaction: { business: { userId: TEST_USER_ID } } },
          { transaction: { personalAccount: { userId: TEST_USER_ID } } },
          { transaction: { business: { userId: OTHER_USER_ID } } },
          { transaction: { personalAccount: { userId: OTHER_USER_ID } } },
        ],
      },
    });
    await db.transaction.deleteMany({
      where: {
        OR: [
          { business: { userId: TEST_USER_ID } },
          { personalAccount: { userId: TEST_USER_ID } },
          { business: { userId: OTHER_USER_ID } },
          { personalAccount: { userId: OTHER_USER_ID } },
        ],
      },
    });
    await db.personalAccount.deleteMany({
      where: { userId: { in: [TEST_USER_ID, OTHER_USER_ID] } },
    });
    await db.category.deleteMany({
      where: { userId: { in: [TEST_USER_ID, OTHER_USER_ID] } },
    });
    await db.user.deleteMany({ where: { id: { in: [TEST_USER_ID, OTHER_USER_ID] } } });

    // Create test user
    await db.user.create({
      data: {
        id: TEST_USER_ID,
        email: "mcp-attachments-test@example.com",
        passwordHash: "test-hash",
        name: "MCP Attachments Test User",
        baseCurrency: "BRL",
      },
    });

    // Create personal account
    const personalAccount = await db.personalAccount.create({
      data: {
        userId: TEST_USER_ID,
        defaultCurrency: "BRL",
      },
    });
    personalAccountId = personalAccount.id;

    // Create test category
    await db.category.create({
      data: {
        userId: TEST_USER_ID,
        name: "Test Category",
        type: "expense",
        isSystem: false,
      },
    });

    // Create test transaction
    const transaction = await db.transaction.create({
      data: {
        entityType: "personal",
        type: "expense",
        amount: 100.0,
        currency: "BRL",
        exchangeRate: 1,
        description: "Test transaction for attachments",
        category: "Test Category",
        date: new Date("2026-10-01T12:00:00.000Z"),
        personalAccountId,
      },
    });
    transactionId = transaction.id;

    // Create other user and transaction for access control tests
    await db.user.create({
      data: {
        id: OTHER_USER_ID,
        email: "other-user@example.com",
        passwordHash: "test-hash",
        name: "Other User",
        baseCurrency: "BRL",
      },
    });

    const otherPersonalAccount = await db.personalAccount.create({
      data: {
        userId: OTHER_USER_ID,
        defaultCurrency: "BRL",
      },
    });

    await db.category.create({
      data: {
        userId: OTHER_USER_ID,
        name: "Test Category",
        type: "expense",
        isSystem: false,
      },
    });

    const otherTransaction = await db.transaction.create({
      data: {
        entityType: "personal",
        type: "expense",
        amount: 50.0,
        currency: "BRL",
        exchangeRate: 1,
        description: "Other user transaction",
        category: "Test Category",
        date: new Date("2026-10-01T12:00:00.000Z"),
        personalAccountId: otherPersonalAccount.id,
      },
    });
    otherUserTransactionId = otherTransaction.id;
  });

  describe("attachReceipt", () => {
    it("should attach a PDF receipt successfully", async () => {
      // Create a small PDF-like content (not a real PDF, just for testing)
      const pdfContent = Buffer.from("%PDF-1.4\nTest PDF content");
      const base64Content = pdfContent.toString("base64");

      const result = await attachReceipt(
        TEST_USER_ID,
        {
          transactionId,
          filename: "receipt.pdf",
          mimeType: "application/pdf",
          contentBase64: base64Content,
        },
        db
      );

      expect(result.id).toBeDefined();
      expect(result.filename).toBe("receipt.pdf");
      expect(result.mimeType).toBe("application/pdf");
      expect(result.sizeBytes).toBe(pdfContent.byteLength);
      expect(result.url).toBeDefined();

      // Verify it was saved in the database
      const attachment = await db.attachment.findUnique({
        where: { id: result.id },
      });
      expect(attachment).toBeDefined();
      expect(attachment?.transactionId).toBe(transactionId);
      expect(attachment?.kind).toBe("RECEIPT");
    });

    it("should attach a JPEG image successfully", async () => {
      // Minimal JPEG header for testing
      const jpegContent = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("JFIF")]);
      const base64Content = jpegContent.toString("base64");

      const result = await attachReceipt(
        TEST_USER_ID,
        {
          transactionId,
          filename: "receipt.jpg",
          mimeType: "image/jpeg",
          contentBase64: base64Content,
        },
        db
      );

      expect(result.filename).toBe("receipt.jpg");
      expect(result.mimeType).toBe("image/jpeg");
    });

    it("should reject transaction not owned by user", async () => {
      const content = Buffer.from("test content");
      const base64Content = content.toString("base64");

      await expect(
        attachReceipt(
          TEST_USER_ID,
          {
            transactionId: otherUserTransactionId,
            filename: "receipt.pdf",
            mimeType: "application/pdf",
            contentBase64: base64Content,
          },
          db
        )
      ).rejects.toThrow("Transaction not found or access denied");
    });

    it("should reject invalid mime type", async () => {
      const content = Buffer.from("test content");
      const base64Content = content.toString("base64");

      await expect(
        attachReceipt(
          TEST_USER_ID,
          {
            transactionId,
            filename: "document.txt",
            mimeType: "text/plain",
            contentBase64: base64Content,
          },
          db
        )
      ).rejects.toThrow("Mime type text/plain is not allowed");
    });

    it("should reject file exceeding size limit", async () => {
      // Create content larger than MAX_FILE_SIZE_BYTES
      const largeContent = Buffer.alloc(MAX_FILE_SIZE_BYTES + 1000);
      const base64Content = largeContent.toString("base64");

      await expect(
        attachReceipt(
          TEST_USER_ID,
          {
            transactionId,
            filename: "large-file.pdf",
            mimeType: "application/pdf",
            contentBase64: base64Content,
          },
          db
        )
      ).rejects.toThrow(/exceeds maximum/);
    });

    it("should reject invalid base64 content", async () => {
      await expect(
        attachReceipt(
          TEST_USER_ID,
          {
            transactionId,
            filename: "receipt.pdf",
            mimeType: "application/pdf",
            contentBase64: "this is not base64 at all!@#$%^&*()",
          },
          db
        )
      ).rejects.toThrow("Invalid base64 content");
    });

    it("should reject non-existent transaction", async () => {
      const content = Buffer.from("test content");
      const base64Content = content.toString("base64");

      await expect(
        attachReceipt(
          TEST_USER_ID,
          {
            transactionId: "00000000-0000-0000-0000-000000000000",
            filename: "receipt.pdf",
            mimeType: "application/pdf",
            contentBase64: base64Content,
          },
          db
        )
      ).rejects.toThrow("Transaction not found or access denied");
    });
  });

  describe("listTransactionAttachments", () => {
    it("should list all attachments for a transaction", async () => {
      // Attach two files
      const content1 = Buffer.from("PDF content 1");
      const content2 = Buffer.from("Image content 2");

      const attachment1 = await attachReceipt(
        TEST_USER_ID,
        {
          transactionId,
          filename: "receipt1.pdf",
          mimeType: "application/pdf",
          contentBase64: content1.toString("base64"),
        },
        db
      );

      const attachment2 = await attachReceipt(
        TEST_USER_ID,
        {
          transactionId,
          filename: "receipt2.jpg",
          mimeType: "image/jpeg",
          contentBase64: content2.toString("base64"),
        },
        db
      );

      const result = await listTransactionAttachments(
        TEST_USER_ID,
        { transactionId },
        db
      );

      expect(result.attachments).toHaveLength(2);
      expect(result.attachments.map((a) => a.id)).toContain(attachment1.id);
      expect(result.attachments.map((a) => a.id)).toContain(attachment2.id);
      expect(result.attachments[0].uploadedAt).toBeDefined();
    });

    it("should return empty list for transaction with no attachments", async () => {
      const result = await listTransactionAttachments(
        TEST_USER_ID,
        { transactionId },
        db
      );

      expect(result.attachments).toHaveLength(0);
    });

    it("should reject transaction not owned by user", async () => {
      await expect(
        listTransactionAttachments(
          TEST_USER_ID,
          { transactionId: otherUserTransactionId },
          db
        )
      ).rejects.toThrow("Transaction not found or access denied");
    });
  });

  describe("deleteAttachment", () => {
    it("should delete an attachment successfully", async () => {
      // Attach a file first
      const content = Buffer.from("PDF content");
      const attachment = await attachReceipt(
        TEST_USER_ID,
        {
          transactionId,
          filename: "receipt.pdf",
          mimeType: "application/pdf",
          contentBase64: content.toString("base64"),
        },
        db
      );

      // Delete it
      const result = await deleteAttachment(
        TEST_USER_ID,
        { attachmentId: attachment.id },
        db
      );

      expect(result.success).toBe(true);
      expect(result.attachmentId).toBe(attachment.id);

      // Verify it's gone from the database
      const deletedAttachment = await db.attachment.findUnique({
        where: { id: attachment.id },
      });
      expect(deletedAttachment).toBeNull();
    });

    it("should reject deleting attachment from other user's transaction", async () => {
      // Create attachment for other user's transaction
      const otherContent = Buffer.from("Other user content");
      const otherAttachment = await attachReceipt(
        OTHER_USER_ID,
        {
          transactionId: otherUserTransactionId,
          filename: "other-receipt.pdf",
          mimeType: "application/pdf",
          contentBase64: otherContent.toString("base64"),
        },
        db
      );

      // Try to delete it as TEST_USER_ID
      await expect(
        deleteAttachment(
          TEST_USER_ID,
          { attachmentId: otherAttachment.id },
          db
        )
      ).rejects.toThrow("Attachment not found");
    });

    it("should reject non-existent attachment", async () => {
      await expect(
        deleteAttachment(
          TEST_USER_ID,
          { attachmentId: "00000000-0000-0000-0000-000000000000" },
          db
        )
      ).rejects.toThrow("Attachment not found");
    });
  });
});
