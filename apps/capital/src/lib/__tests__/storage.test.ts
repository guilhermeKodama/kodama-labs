import { describe, expect, it, vi } from "vitest";

vi.mock("@/env", () => ({
  env: { CAPITAL_BLOB_DIR: "/tmp/x", NEXT_PUBLIC_APP_URL: "http://localhost" },
}));

import { buildAttachmentPath } from "../storage";

const UUID = "[0-9a-f-]{36}";

function pattern(owner: string, folder: string, slug: string, ext: string) {
  return new RegExp(`^capital/${owner}/${folder}/${UUID}-${slug}\\.${ext}$`);
}

describe("buildAttachmentPath", () => {
  it("builds capital/<owner>/<kind>/<uuid>-<slug>.<ext>", () => {
    expect(buildAttachmentPath("BILL", "user1", "fatura.pdf")).toMatch(
      pattern("user1", "bill", "fatura", "pdf"),
    );
  });

  it.each([
    ["BILL", "bill"],
    ["RECEIPT", "receipt"],
    ["TRANSFER_RECEIPT", "transfer_receipt"],
  ] as const)("maps kind %s to folder %s", (kind, folder) => {
    expect(buildAttachmentPath(kind, "u", "a.pdf")).toMatch(
      pattern("u", folder, "a", "pdf"),
    );
  });

  it("lowercases the extension", () => {
    expect(buildAttachmentPath("BILL", "u", "Fatura.PDF")).toMatch(
      pattern("u", "bill", "fatura", "pdf"),
    );
  });

  it("falls back to .bin without an extension and keeps the whole name as slug", () => {
    expect(buildAttachmentPath("BILL", "u", "Minha Fatura")).toMatch(
      pattern("u", "bill", "minha-fatura", "bin"),
    );
  });

  it("falls back to .bin when the extension is longer than 8 characters", () => {
    // Current behavior: the slug still drops the trailing ".<alnum>+" segment,
    // even though it was not accepted as the extension.
    expect(buildAttachmentPath("BILL", "u", "fatura.abcdefghi")).toMatch(
      pattern("u", "bill", "fatura", "bin"),
    );
  });

  it("slugifies accents and spaces", () => {
    expect(buildAttachmentPath("BILL", "u", "Conta de Luz Água.png")).toMatch(
      pattern("u", "bill", "conta-de-luz-agua", "png"),
    );
  });

  it("truncates the slug to 60 characters", () => {
    const path = buildAttachmentPath("BILL", "u", `${"a".repeat(100)}.pdf`);
    expect(path).toMatch(pattern("u", "bill", `a{60}`, "pdf"));
  });

  it.each(["@@@.pdf", ".pdf", ""])("uses slug 'file' for %j", (name) => {
    const ext = name === "" ? "bin" : "pdf";
    expect(buildAttachmentPath("BILL", "u", name)).toMatch(
      pattern("u", "bill", "file", ext),
    );
  });

  it("strips only the last extension from the slug", () => {
    expect(buildAttachmentPath("BILL", "u", "a.b.tar.gz")).toMatch(
      pattern("u", "bill", "a-b-tar", "gz"),
    );
  });

  it("generates different paths for the same input", () => {
    const a = buildAttachmentPath("BILL", "u", "a.pdf");
    const b = buildAttachmentPath("BILL", "u", "a.pdf");
    expect(a).not.toBe(b);
  });

  it("normalizes slashes around the ownerId", () => {
    expect(buildAttachmentPath("BILL", "/user1/", "a.pdf")).toMatch(
      pattern("user1", "bill", "a", "pdf"),
    );
  });
});
