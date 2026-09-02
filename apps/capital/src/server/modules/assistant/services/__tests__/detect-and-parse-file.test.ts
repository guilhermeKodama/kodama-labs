import { describe, it, expect } from "vitest";
import { detectFile, parseStatementFile } from "../detect-and-parse-file";

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(16)]);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(16),
]);
const WEBP = Buffer.concat([
  Buffer.from("RIFF", "latin1"),
  Buffer.from([0, 0, 0, 0]),
  Buffer.from("WEBP", "latin1"),
  Buffer.alloc(16),
]);
const GIF = Buffer.concat([Buffer.from("GIF89a", "latin1"), Buffer.alloc(16)]);

describe("detectFile - images", () => {
  it.each([
    ["jpeg", JPEG, "image/jpeg"],
    ["png", PNG, "image/png"],
    ["webp", WEBP, "image/webp"],
    ["gif", GIF, "image/gif"],
  ])("sniffs %s from magic bytes", (_name, buffer, mediaType) => {
    const detected = detectFile(buffer, "screenshot-123.png");
    expect(detected.fileType).toBe("image");
    expect(detected.statementKind).toBe("image");
    expect(detected.mediaType).toBe(mediaType);
  });

  it("ignores the filename - content decides", () => {
    // A screenshot saved as .csv is still an image, and a .csv named
    // .png is still a CSV. Content sniffing is the whole point.
    expect(detectFile(PNG, "extrato.csv").fileType).toBe("image");
    expect(detectFile(Buffer.from("date,description\n"), "foto.png").fileType).toBe("csv");
  });

  it("does not treat a short buffer as an image", () => {
    expect(detectFile(Buffer.from([0xff, 0xd8]), "x.csv").fileType).toBe("csv");
  });
});

describe("detectFile - existing formats still win", () => {
  it("keeps detecting bank OFX", () => {
    const d = detectFile(Buffer.from("OFXHEADER:100\n<OFX><STMTRS>"), "e.ofx");
    expect(d).toMatchObject({ fileType: "ofx", statementKind: "bank_ofx" });
  });

  it("keeps detecting card OFX", () => {
    const d = detectFile(Buffer.from("OFXHEADER:100\n<OFX><CCSTMTRS>"), "f.ofx");
    expect(d).toMatchObject({ fileType: "ofx", statementKind: "card_ofx" });
  });

  it("keeps detecting PDF", () => {
    const d = detectFile(Buffer.concat([Buffer.from("%PDF-1.7"), Buffer.alloc(16)]), "n.pdf");
    expect(d).toMatchObject({ fileType: "pdf", statementKind: "investment_pdf" });
  });

  it("keeps detecting CSV by extension", () => {
    const d = detectFile(Buffer.from("date,description,amount\n"), "fatura.csv");
    expect(d).toMatchObject({ fileType: "csv", statementKind: "card_csv" });
  });

  it("still rejects unrecognized content as unknown", () => {
    expect(detectFile(Buffer.from("just some text here"), "notes.txt").statementKind).toBe(
      "unknown"
    );
  });
});

describe("parseStatementFile", () => {
  it("does not parse images - the model reads them", () => {
    const detected = detectFile(PNG, "recibo.png");
    expect(parseStatementFile(PNG, detected)).toEqual({ parseStatus: "not_applicable" });
  });
});
