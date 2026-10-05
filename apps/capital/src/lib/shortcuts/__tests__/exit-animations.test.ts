import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FLOATING } from "@/components/cap/styles";

/**
 * Radix keeps a closing popover, menu or dialog mounted until its exit
 * animation ends, and while mounted it is still the top dismissable layer:
 * it takes the next Esc (and blocks pointer events outside it). An Esc
 * pressed during the fade-out, meant for the dialog underneath, is lost.
 * So the cap layers close without an exit animation. The backdrop
 * (styles.ts BACKDROP) may fade: it is not a layer.
 */

const CAP = path.resolve(__dirname, "../../../components/cap");
const EXIT = /data-\[state=closed\]:animate-out/;

describe("cap overlays", () => {
  it("floating layers close without an exit animation", () => {
    expect(FLOATING).not.toMatch(EXIT);
  });

  it("no primitive adds an exit animation to its content", () => {
    const offenders = fs
      .readdirSync(CAP)
      .filter((name) => name.endsWith(".tsx"))
      .filter((name) => EXIT.test(fs.readFileSync(path.join(CAP, name), "utf8")));
    expect(offenders).toEqual([]);
  });
});
