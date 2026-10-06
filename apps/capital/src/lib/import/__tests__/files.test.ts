import { describe, expect, it } from "vitest";
import { bytesToBase64, fileBadge, filePayload, fileSize, goesToAssistant } from "../files";

describe("import files", () => {
  it("badges a file by its name or type", () => {
    expect(fileBadge("nubank-fatura-2026-09.ofx")).toBe("OFX");
    expect(fileBadge("extrato.QFX")).toBe("OFX");
    expect(fileBadge("fatura.csv")).toBe("CSV");
    expect(fileBadge("export", "text/csv")).toBe("CSV");
    expect(fileBadge("nota.pdf")).toBe("PDF");
    expect(fileBadge("print.PNG")).toBe("IMG");
    expect(fileBadge("foto", "image/heic")).toBe("IMG");
    expect(fileBadge("sem-extensao")).toBe("TXT");
  });

  it("sends PDFs and pictures to the assistant", () => {
    expect(goesToAssistant({ name: "xp-nota.pdf" })).toBe(true);
    expect(goesToAssistant({ name: "fatura.jpg", type: "image/jpeg" })).toBe(true);
    expect(goesToAssistant({ name: "extrato.ofx" })).toBe(false);
  });

  it("sizes in KB (at least 1) and MB", () => {
    expect(fileSize(18 * 1024)).toEqual({ value: 18, unit: "KB" });
    expect(fileSize(10)).toEqual({ value: 1, unit: "KB" });
    expect(fileSize(2.5 * 1024 * 1024)).toEqual({ value: 2.5, unit: "MB" });
  });

  it("encodes the raw bytes as base64, also past one chunk", async () => {
    const latin1 = Buffer.from("PAGAMENTO CARTÃO", "latin1");
    expect(bytesToBase64(new Uint8Array(latin1))).toBe(latin1.toString("base64"));
    const big = Buffer.alloc(100_000, 7);
    expect(bytesToBase64(new Uint8Array(big))).toBe(big.toString("base64"));
    const file = { name: "extrato.ofx", arrayBuffer: async () => new Uint8Array(latin1).buffer };
    expect(await filePayload(file)).toEqual({ name: "extrato.ofx", content: latin1.toString("base64"), encoding: "base64" });
  });
});
