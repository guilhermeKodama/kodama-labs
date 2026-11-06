import { describe, expect, it } from "vitest";
import { localBlobFilePath, localBlobUrl } from "./paths";

describe("local blob paths", () => {
  it("builds a local url from the app origin and the object key", () => {
    expect(
      localBlobUrl("https://sentinel.kodamalabs.ai/", "procurements/proc-1/1-edital.pdf"),
    ).toBe("https://sentinel.kodamalabs.ai/api/blob/procurements/proc-1/1-edital.pdf");
  });

  it("maps a key onto a file inside the blob directory", () => {
    expect(localBlobFilePath("/data/blob", "procurements/proc-1/1-edital.pdf")).toBe(
      "/data/blob/procurements/proc-1/1-edital.pdf",
    );
  });

  it("refuses a key that escapes the blob directory", () => {
    expect(() => localBlobFilePath("/data/blob", "../etc/passwd")).toThrow(/outside local dir/);
    expect(() => localBlobFilePath("/data/blob", "foo/../../etc/passwd")).toThrow(
      /outside local dir/,
    );
    expect(() => localBlobFilePath("/data/blob", "/etc/passwd")).toThrow(/outside local dir/);
  });
});
