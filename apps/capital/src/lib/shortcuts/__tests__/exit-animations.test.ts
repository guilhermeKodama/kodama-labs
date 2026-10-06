import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FLOATING } from "@/components/cap/styles";

/**
 * Radix keeps a closing popover, menu or dialog mounted until its exit
 * animation ends, and while mounted it is still the top dismissable layer:
 * it takes the next Esc (and blocks pointer events outside it). An Esc
 * pressed during the fade-out, meant for the dialog underneath, is lost.
 * So the cap layers, and the shadcn ones in components/ui, close without an
 * exit animation. A full-page backdrop (styles.ts BACKDROP, the shadcn
 * overlays) may fade: it is not a layer.
 */

const COMPONENTS = path.resolve(__dirname, "../../../components");
const EXIT = /data-\[state=closed\]:animate-out/;
const BACKDROP = /\bfixed inset-0\b/;

/** "file.tsx:line" for each class string in `dir` that animates a closing layer. */
function exitAnimations(dir: string): string[] {
  return fs
    .readdirSync(path.join(COMPONENTS, dir))
    .filter((name) => name.endsWith(".tsx"))
    .flatMap((name) =>
      fs
        .readFileSync(path.join(COMPONENTS, dir, name), "utf8")
        .split("\n")
        .flatMap((line, index) => (EXIT.test(line) && !BACKDROP.test(line) ? [`${name}:${index + 1}`] : [])),
    );
}

describe("overlay exit animations", () => {
  it("floating layers close without an exit animation", () => {
    expect(FLOATING).not.toMatch(EXIT);
  });

  it("no cap primitive adds one to its content", () => {
    expect(exitAnimations("cap")).toEqual([]);
  });

  it("the shadcn sheet, menu and select close without one either", () => {
    expect(exitAnimations("ui")).toEqual([]);
  });
});
