import { describe, expect, it } from "vitest";
import { ALLOWED_ASSISTANT_EXTENSIONS } from "@/lib/assistant/constants";
import { NOTE_FILE_ACCEPT, NOTE_FILE_EXTENSIONS } from "../note-import";

describe("Importar nota picker", () => {
  it("accepts PDF and the images the assistant reads, never image/* (HEIC would be rejected later)", () => {
    expect(NOTE_FILE_ACCEPT).toBe(".pdf,.jpg,.jpeg,.png,.webp");
    expect(NOTE_FILE_ACCEPT).not.toContain("image/");
    for (const ext of NOTE_FILE_EXTENSIONS) expect(ALLOWED_ASSISTANT_EXTENSIONS).toContain(ext);
  });
});
