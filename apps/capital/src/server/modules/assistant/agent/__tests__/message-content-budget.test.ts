import { beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FILE_REQUEST_BUDGET_BYTES, MAX_PDFS_PER_TURN } from "../../constants";

/**
 * The limits on what one request can carry (buildApiMessages hydrates file
 * refs into base64 blocks): the byte budget shared by PDFs and images, the
 * cap on PDFs, and the placeholder a PDF turns into once it is out of
 * reach. message-content.test.ts covers the image paths.
 */

const getObjectBuffer = vi.fn();
vi.mock("@/lib/storage", () => ({ getObjectBuffer: (url: string) => getObjectBuffer(url) }));

const { buildApiMessages } = await import("../message-content");

const ref = (name: string, mediaType: string | undefined, blobUrl = `blob://${name}`) => ({
  type: "capital_file_ref",
  fileId: name,
  originalName: name,
  blobUrl,
  ...(mediaType && { mediaType }),
});
const blockTypes = (message: { content: unknown }) => (message.content as Array<{ type: string }>).map((block) => block.type);

beforeEach(() => {
  getObjectBuffer.mockReset();
  getObjectBuffer.mockResolvedValue(Buffer.from("bytes"));
});

describe("PDF refs", () => {
  it("collapses a PDF of an older message to a placeholder that points at list_statement_files", async () => {
    const messages = await buildApiMessages([
      { role: "user", content: [ref("nota.pdf", "application/pdf")] },
      { role: "assistant", content: [{ type: "text", text: "li a nota" }] },
      { role: "user", content: [{ type: "text", text: "e então?" }] },
    ]);

    expect(messages[0]!.content).toEqual([
      {
        type: "text",
        text: '[Arquivo PDF "nota.pdf" anexado anteriormente nesta conversa - use list_statement_files ou peça para o usuário reenviar se precisar reler o conteúdo.]',
      },
    ]);
    expect(getObjectBuffer).not.toHaveBeenCalled();
  });

  it("hydrates at most MAX_PDFS_PER_TURN PDFs of the last message and placeholders the rest", async () => {
    const pdfs = Array.from({ length: MAX_PDFS_PER_TURN + 2 }, (_, i) => ref(`n${i}.pdf`, "application/pdf"));

    const [message] = await buildApiMessages([{ role: "user", content: pdfs }]);

    expect(blockTypes(message!).filter((type) => type === "document")).toHaveLength(MAX_PDFS_PER_TURN);
    expect(blockTypes(message!).filter((type) => type === "text")).toHaveLength(2);
    // Images have a count of their own: a full PDF quota does not block an image.
    const [mixed] = await buildApiMessages([{ role: "user", content: [...pdfs, ref("foto.png", "image/png")] }]);
    expect(blockTypes(mixed!).filter((type) => type === "image")).toHaveLength(1);
  });
});

describe("the shared byte budget", () => {
  it("stops hydrating once the next file would not fit, whatever its type", async () => {
    const big = Buffer.alloc(MAX_FILE_REQUEST_BUDGET_BYTES - 1024);
    getObjectBuffer.mockImplementation(async (url: string) => (url.endsWith("grande.pdf") ? big : Buffer.alloc(2048)));

    const [message] = await buildApiMessages([
      { role: "user", content: [ref("grande.pdf", "application/pdf"), ref("foto.png", "image/png"), ref("outra.pdf", "application/pdf")] },
    ]);

    // The first fills the budget; the others no longer fit.
    expect(blockTypes(message!)).toEqual(["document", "text", "text"]);
  });

  it("accepts a file that brings the total exactly to the budget", async () => {
    getObjectBuffer.mockResolvedValue(Buffer.alloc(MAX_FILE_REQUEST_BUDGET_BYTES));

    const [message] = await buildApiMessages([{ role: "user", content: [ref("justo.pdf", "application/pdf")] }]);

    expect(blockTypes(message!)).toEqual(["document"]);
  });

  it("falls back to the placeholder when storage has no such object", async () => {
    getObjectBuffer.mockResolvedValue(null);

    const [message] = await buildApiMessages([{ role: "user", content: [ref("sumiu.pdf", "application/pdf")] }]);

    expect(blockTypes(message!)).toEqual(["text"]);
  });
});
