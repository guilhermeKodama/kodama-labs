import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TEXT_SIZE_TOKENS, cn } from "../utils";

/** The text-cap-* sizes (Ajustes › Tamanho da letra): defined in globals.css and known to cn(). */
describe("text size tokens", () => {
  it("globals.css defines every token, scaled by --cap-text-scale", () => {
    const css = readFileSync(join(__dirname, "../../app/globals.css"), "utf8");
    for (const size of TEXT_SIZE_TOKENS) {
      expect(css).toContain(`--text-cap-${size.replace(".", "\\.")}: calc(${size}px * var(--cap-text-scale));`);
    }
    expect(css).toMatch(/\[data-text-size="sm"\]\s*\{\s*--cap-text-scale: 0\.92;/);
    expect(css).toMatch(/\[data-text-size="lg"\]\s*\{\s*--cap-text-scale: 1\.14;/);
  });

  it("cn() keeps a size token next to a text color and lets a later size win", () => {
    expect(cn("text-cap-12", "text-fg-3")).toBe("text-cap-12 text-fg-3");
    expect(cn("text-cap-10.5 text-neg", "text-cap-13")).toBe("text-neg text-cap-13");
    expect(cn("text-[12px]", "text-cap-11")).toBe("text-cap-11");
  });
});
