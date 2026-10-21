import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const globals = readFileSync(join(__dirname, "../../../app/globals.css"), "utf8");

/** The body of the first `<selector> { … }` block after `from` in globals.css. */
function blockAfter(from: string, selector: string): string {
  const start = globals.indexOf(from);
  expect(start, from).toBeGreaterThanOrEqual(0);
  const open = globals.indexOf(`${selector} {`, start);
  return globals.slice(open, globals.indexOf("}", open));
}

describe("safe areas (src/app/globals.css)", () => {
  it("reads the device insets everywhere", () => {
    const base = blockAfter("html {", "html");
    for (const side of ["top", "right", "bottom", "left"]) expect(base).toContain(`--safe-${side}: env(safe-area-inset-${side}, 0px);`);
  });

  it("keeps the top bar below iOS 26's edge blur in the installed app: 40pt more top clearance", () => {
    const rule = "@media (display-mode: standalone) {\n  @supports (-webkit-touch-callout: none) and (anchor-name: --a) {";
    expect(globals).toContain(rule);
    expect(blockAfter(rule, "html")).toContain("--safe-top: calc(env(safe-area-inset-top, 0px) + 40px);");
  });
});
