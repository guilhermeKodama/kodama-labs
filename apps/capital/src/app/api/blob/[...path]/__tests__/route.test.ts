import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@capital/server/lib/prisma";
import { uploadAttachment } from "@capital/server/modules/attachments/services/attachments";
import { createEntry } from "@capital/server/modules/ledger/services/entries";
import { createLedgerFixture, deleteLedgerFixture, type LedgerFixture } from "@/test/ledger-fixtures";
import { GET } from "../route";

/** Stored files are only for their owner's session now that the app is on the internet without Cloudflare Access. */
const OWNER = "test-user-blob-access-owner";
const OTHER = "test-user-blob-access-other";
let owner: LedgerFixture;
let pathname: string;
let ownerCookie: string;
let otherCookie: string;

const session = async (userId: string) =>
  `capital_session=${(await prisma.session.create({ data: { userId, expiresAt: new Date(Date.now() + 3600_000) } })).id}`;

const get = (cookie?: string, path = pathname) =>
  GET(new Request(`http://local.test/api/blob/${path}`, { headers: cookie ? { cookie } : {} }), {
    params: Promise.resolve({ path: path.split("/").map(encodeURIComponent) }),
  });

beforeAll(async () => {
  owner = await createLedgerFixture(prisma, OWNER);
  await createLedgerFixture(prisma, OTHER);
  const entry = await createEntry(OWNER, { kind: "expense", accountId: owner.pfChecking, date: "2026-09-01", description: "Recibo da prova", amount: 10 }, prisma);
  const attachment = await uploadAttachment(
    OWNER,
    { kind: "RECEIPT", ownerType: "entry", ownerId: entry.entryIds[0], file: { buffer: Buffer.from("%PDF-1.4 recibo"), mimeType: "application/pdf", originalName: "recibo.pdf" } },
    prisma
  );
  pathname = attachment.pathname;
  ownerCookie = await session(OWNER);
  otherCookie = await session(OTHER);
});

afterAll(async () => {
  await deleteLedgerFixture(prisma, OWNER);
  await deleteLedgerFixture(prisma, OTHER);
});

describe("GET /api/blob/*", () => {
  it("serves a file to its owner", async () => {
    const res = await get(ownerCookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("%PDF-1.4 recibo");
  });

  it("asks for a session without one, and answers another user as if the file did not exist", async () => {
    expect((await get()).status).toBe(401);
    expect((await get("capital_session=nope")).status).toBe(401);
    expect((await get(otherCookie)).status).toBe(404);
    expect((await get(ownerCookie, "capital/someone/receipt/not-stored.pdf")).status).toBe(404);
  });
});
