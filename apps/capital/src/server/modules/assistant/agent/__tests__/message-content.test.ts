import { describe, it, expect, vi, beforeEach } from "vitest";

const getObjectBuffer = vi.fn();
vi.mock("@/lib/storage", () => ({ getObjectBuffer: (url: string) => getObjectBuffer(url) }));

const { buildApiMessages, hydrateMediaRef } = await import("../message-content");

const IMAGE_BYTES = Buffer.from("fake-png-bytes");
const PDF_BYTES = Buffer.from("fake-pdf-bytes");

function imageRef(overrides: Record<string, unknown> = {}) {
  return {
    type: "capital_file_ref",
    fileId: "f1",
    originalName: "recibo.png",
    blobUrl: "blob://recibo.png",
    mediaType: "image/png",
    ...overrides,
  };
}

beforeEach(() => {
  getObjectBuffer.mockReset();
  getObjectBuffer.mockResolvedValue(IMAGE_BYTES);
});

describe("buildApiMessages - image refs", () => {
  it("hydrates an image ref on the last user message into an image block", async () => {
    const messages = await buildApiMessages([
      { role: "user", content: [{ type: "text", text: "o que é isso?" }, imageRef()] },
    ]);

    expect(messages[0]!.content).toEqual([
      { type: "text", text: "o que é isso?" },
      {
        type: "image",
        source: {
          type: "base64",
          media_type: "image/png",
          data: IMAGE_BYTES.toString("base64"),
        },
      },
    ]);
  });

  it("treats a ref with no mediaType as a PDF - rows written before image support", async () => {
    getObjectBuffer.mockResolvedValue(PDF_BYTES);
    const legacy = { ...imageRef({ originalName: "nota.pdf" }) };
    delete (legacy as Record<string, unknown>).mediaType;

    const messages = await buildApiMessages([{ role: "user", content: [legacy] }]);

    expect(messages[0]!.content).toEqual([
      {
        type: "document",
        title: "nota.pdf",
        source: {
          type: "base64",
          media_type: "application/pdf",
          data: PDF_BYTES.toString("base64"),
        },
      },
    ]);
  });

  it("collapses an image ref on an OLDER user message to a placeholder", async () => {
    const messages = await buildApiMessages([
      { role: "user", content: [imageRef()] },
      { role: "assistant", content: [{ type: "text", text: "é um recibo" }] },
      { role: "user", content: [{ type: "text", text: "e agora?" }] },
    ]);

    const first = messages[0]!.content as Array<{ type: string; text?: string }>;
    expect(first[0]!.type).toBe("text");
    expect(first[0]!.text).toContain("recibo.png");
    // The whole point: the bytes are never re-fetched for old turns.
    expect(getObjectBuffer).not.toHaveBeenCalled();
  });

  it("falls back to a placeholder when storage fails", async () => {
    getObjectBuffer.mockRejectedValue(new Error("gone"));
    const messages = await buildApiMessages([{ role: "user", content: [imageRef()] }]);
    expect((messages[0]!.content as Array<{ type: string }>)[0]!.type).toBe("text");
  });

  it("rejects a media type the API does not accept", async () => {
    const messages = await buildApiMessages([
      { role: "user", content: [imageRef({ mediaType: "image/svg+xml" })] },
    ]);
    expect((messages[0]!.content as Array<{ type: string }>)[0]!.type).toBe("text");
  });

  it("caps hydration at MAX_IMAGES_PER_TURN, placeholdering the rest", async () => {
    const refs = Array.from({ length: 7 }, (_, i) =>
      imageRef({ fileId: `f${i}`, originalName: `img-${i}.png`, blobUrl: `blob://${i}` })
    );
    const messages = await buildApiMessages([{ role: "user", content: refs }]);

    const blocks = messages[0]!.content as Array<{ type: string }>;
    expect(blocks.filter((b) => b.type === "image")).toHaveLength(5);
    expect(blocks.filter((b) => b.type === "text")).toHaveLength(2);
  });
});

describe("buildApiMessages - refs nested in tool_result", () => {
  it("replaces a read_attachment ref with a placeholder on replay", async () => {
    const messages = await buildApiMessages([
      { role: "assistant", content: [{ type: "text", text: "vou abrir" }] },
      {
        role: "user",
        content: [
          {
            type: "tool_result",
            tool_use_id: "tu_1",
            content: [{ type: "text", text: "{}" }, imageRef()],
            is_error: false,
          },
        ],
      },
    ]);

    const toolResult = (messages[1]!.content as unknown as Array<Record<string, unknown>>)[0]!;
    const inner = toolResult.content as Array<{ type: string; text?: string }>;
    expect(inner).toHaveLength(2);
    expect(inner[1]!.type).toBe("text");
    expect(inner[1]!.text).toContain("recibo.png");
    expect(getObjectBuffer).not.toHaveBeenCalled();
  });

  it("leaves a plain string tool_result untouched", async () => {
    const block = { type: "tool_result", tool_use_id: "tu_2", content: "{\"ok\":true}", is_error: false };
    const messages = await buildApiMessages([{ role: "user", content: [block] }]);
    expect((messages[0]!.content as unknown[])[0]).toEqual(block);
  });
});

describe("hydrateMediaRef", () => {
  it("loads an image for a tool result", async () => {
    const block = await hydrateMediaRef({
      originalName: "r.png",
      blobUrl: "blob://r",
      mediaType: "image/png",
    });
    expect(block).toMatchObject({ type: "image" });
  });

  it("loads a PDF for a tool result", async () => {
    const block = await hydrateMediaRef({
      originalName: "r.pdf",
      blobUrl: "blob://r",
      mediaType: "application/pdf",
    });
    expect(block).toMatchObject({ type: "document", title: "r.pdf" });
  });

  it("returns null for a type the API cannot read", async () => {
    expect(
      await hydrateMediaRef({ originalName: "a.zip", blobUrl: "b", mediaType: "application/zip" })
    ).toBeNull();
  });

  it("returns null when storage throws", async () => {
    getObjectBuffer.mockRejectedValue(new Error("boom"));
    expect(
      await hydrateMediaRef({ originalName: "r.png", blobUrl: "b", mediaType: "image/png" })
    ).toBeNull();
  });
});
