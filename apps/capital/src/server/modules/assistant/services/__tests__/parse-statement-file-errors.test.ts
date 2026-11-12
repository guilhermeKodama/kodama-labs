import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DetectedFile } from "../detect-and-parse-file";
import { parseStatementFile } from "../detect-and-parse-file";
import { parseOfxContent, parseOfxCreditCardContent } from "@capital/server/modules/bank-statements/services/parsers";
import { parseCsvContent } from "@capital/server/modules/credit-cards/services/parsers";

/**
 * A parser can throw something that is not an Error (a string, a bare
 * object). parseStatementFile must still answer `failed`, with a message in
 * Portuguese for the file chip instead of "undefined". The parsers are
 * mocked so they can be made to throw exactly that.
 */

vi.mock("@capital/server/modules/bank-statements/services/parsers", () => ({
  parseOfxContent: vi.fn(),
  parseOfxCreditCardContent: vi.fn(),
}));
vi.mock("@capital/server/modules/credit-cards/services/parsers", () => ({
  parseCsvContent: vi.fn(),
}));

const buffer = Buffer.from("conteúdo");
const detected = (fileType: DetectedFile["fileType"], statementKind: DetectedFile["statementKind"]): DetectedFile => ({ fileType, statementKind });

beforeEach(() => {
  vi.mocked(parseOfxContent).mockReset();
  vi.mocked(parseOfxCreditCardContent).mockReset();
  vi.mocked(parseCsvContent).mockReset();
});

describe("a parser that throws something that is not an Error", () => {
  it("answers the generic message for a bank OFX", () => {
    vi.mocked(parseOfxContent).mockImplementation(() => {
      throw "boom";
    });
    expect(parseStatementFile(buffer, detected("ofx", "bank_ofx"))).toEqual({ parseStatus: "failed", parseError: "Falha ao ler o OFX" });
  });

  it("answers the generic message for a card OFX", () => {
    vi.mocked(parseOfxCreditCardContent).mockImplementation(() => {
      throw { reason: "boom" };
    });
    expect(parseStatementFile(buffer, detected("ofx", "card_ofx"))).toEqual({ parseStatus: "failed", parseError: "Falha ao ler o OFX de cartão" });
  });

  it("answers the generic message for a CSV", () => {
    vi.mocked(parseCsvContent).mockImplementation(() => {
      throw null;
    });
    expect(parseStatementFile(buffer, detected("csv", "card_csv"))).toEqual({ parseStatus: "failed", parseError: "Falha ao ler o CSV" });
  });
});

describe("a parser that throws an Error", () => {
  it("passes its message through for each format", () => {
    vi.mocked(parseOfxContent).mockImplementation(() => {
      throw new Error("OFX quebrado");
    });
    vi.mocked(parseOfxCreditCardContent).mockImplementation(() => {
      throw new Error("OFX de cartão quebrado");
    });
    vi.mocked(parseCsvContent).mockImplementation(() => {
      throw new Error("CSV quebrado");
    });

    expect(parseStatementFile(buffer, detected("ofx", "bank_ofx")).parseError).toBe("OFX quebrado");
    expect(parseStatementFile(buffer, detected("ofx", "card_ofx")).parseError).toBe("OFX de cartão quebrado");
    expect(parseStatementFile(buffer, detected("csv", "card_csv")).parseError).toBe("CSV quebrado");
  });
});

describe("files the model reads itself", () => {
  it("never calls a parser for a PDF or an image", () => {
    expect(parseStatementFile(buffer, detected("pdf", "investment_pdf"))).toEqual({ parseStatus: "not_applicable" });
    expect(parseStatementFile(buffer, detected("image", "image"))).toEqual({ parseStatus: "not_applicable" });
    expect(parseOfxContent).not.toHaveBeenCalled();
    expect(parseOfxCreditCardContent).not.toHaveBeenCalled();
    expect(parseCsvContent).not.toHaveBeenCalled();
  });
});
