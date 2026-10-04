import { describe, expect, it } from "vitest";
import {
  isVercelBlobUrl,
  localBlobFilePath,
  localBlobUrl,
  pathnameFromVercelBlobUrl,
  rewriteBlobReference,
  storageKeyForBlob,
} from "./paths";

const VERCEL =
  "https://abc123.public.blob.vercel-storage.com/procurements/proc-1/1-edital.pdf";

describe("vercel blob url rewrite", () => {
  it("recognizes public and private blob hosts", () => {
    expect(isVercelBlobUrl(VERCEL)).toBe(true);
    expect(
      isVercelBlobUrl("https://abc123.private.blob.vercel-storage.com/a/b.bin"),
    ).toBe(true);
    expect(isVercelBlobUrl("https://capital.kodamalabs.ai/api/blob/a/b.bin")).toBe(
      false,
    );
    expect(isVercelBlobUrl("not a url")).toBe(false);
  });

  it("maps a vercel url onto the local key, file path, and url", () => {
    expect(pathnameFromVercelBlobUrl(VERCEL)).toBe("procurements/proc-1/1-edital.pdf");
    expect(storageKeyForBlob(VERCEL, null)).toBe("procurements/proc-1/1-edital.pdf");
    expect(localBlobUrl("https://sentinel.kodamalabs.ai/", "procurements/proc-1/1-edital.pdf")).toBe(
      "https://sentinel.kodamalabs.ai/api/blob/procurements/proc-1/1-edital.pdf",
    );
    expect(localBlobFilePath("/data/blob", "procurements/proc-1/1-edital.pdf")).toBe(
      "/data/blob/procurements/proc-1/1-edital.pdf",
    );
  });

  it("prefers a relative pathname column over the url path", () => {
    const url =
      "https://abc123.public.blob.vercel-storage.com/capital/user/receipts/other.pdf";
    const key = storageKeyForBlob(url, "capital/user/receipts/file.pdf");
    expect(key).toBe("capital/user/receipts/file.pdf");
    expect(rewriteBlobReference(url, "https://capital.kodamalabs.ai", key)).toEqual({
      key: "capital/user/receipts/file.pdf",
      localUrl: "https://capital.kodamalabs.ai/api/blob/capital/user/receipts/file.pdf",
    });
  });

  it("ignores a pathname that is itself a vercel url", () => {
    expect(storageKeyForBlob(VERCEL, VERCEL)).toBe("procurements/proc-1/1-edital.pdf");
  });

  it("strips the query string and decodes the path", () => {
    const url =
      "https://abc123.public.blob.vercel-storage.com/capital/u/a%20b.pdf?download=1";
    expect(pathnameFromVercelBlobUrl(url)).toBe("capital/u/a b.pdf");
  });

  it("refuses a key that escapes the blob directory", () => {
    expect(() => localBlobFilePath("/data/blob", "../etc/passwd")).toThrow(/outside local dir/);
    expect(() => localBlobFilePath("/data/blob", "foo/../../etc/passwd")).toThrow(
      /outside local dir/,
    );
    // A bad pathname column is ignored in favor of the URL path.
    expect(storageKeyForBlob(VERCEL, "../etc/passwd")).toBe(
      "procurements/proc-1/1-edital.pdf",
    );
    // The URL parser collapses dot segments before we see them, so the
    // resulting key stays inside the blob directory.
    expect(
      pathnameFromVercelBlobUrl(
        "https://abc123.public.blob.vercel-storage.com/../../etc/passwd",
      ),
    ).toBe("etc/passwd");
  });
});
