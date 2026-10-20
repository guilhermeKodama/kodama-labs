import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PALETTE } from "@/lib/settings/palette";
import { CERNE_HUES, SERIES_NAMES } from "@/lib/theme/chart-colors";

/**
 * Brand consistency: every chart and every swatch takes the Cerne hues the
 * owner approved on the canvas, in light and dark, and a status is never
 * drawn with a category's color (it is pos, neg, warn or resin).
 */
const SRC = path.resolve(__dirname, "../..");
const css = fs.readFileSync(path.join(SRC, "app/globals.css"), "utf8");

function token(block: ":root" | ".dark", name: string): string {
  const start = css.indexOf(`${block} {`);
  const body = css.slice(start, css.indexOf("\n}", start));
  const match = new RegExp(`--${name}:\\s*([^;]+);`).exec(body);
  if (!match) throw new Error(`--${name} not found in ${block}`);
  return match[1].trim().toLowerCase();
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else if (/\.tsx?$/.test(entry.name) && !file.includes("__tests__")) out.push(file);
  }
  return out;
}

describe("the Cerne palette", () => {
  it("gives each chart series its hue, in order, in both themes", () => {
    SERIES_NAMES.forEach((name, i) => {
      expect(token(":root", `cap-chart-${i + 1}`), name).toBe(CERNE_HUES[name].light);
      expect(token(".dark", `cap-chart-${i + 1}`), name).toBe(CERNE_HUES[name].dark);
    });
  });

  it("draws single-series charts and heatmaps in heartwood, never charcoal", () => {
    expect(token(":root", "cap-chart-bar")).toBe(CERNE_HUES.cerne.light);
    expect(token(":root", "cap-chart-ink")).toBe(CERNE_HUES.cerne.light);
    expect(token(":root", "cap-heat")).toBe(CERNE_HUES.cerne.light);
  });

  it("points shadcn's chart colors at the Cerne series", () => {
    for (const block of [":root", ".dark"] as const) {
      for (let i = 1; i <= 5; i++) expect(token(block, `chart-${i}`)).toBe(`var(--cap-chart-${i})`);
    }
  });

  it("makes every category and entity swatch a Cerne hue", () => {
    for (const swatch of PALETTE) {
      const hue = CERNE_HUES[swatch.name];
      expect(swatch.hex).toBe(hue.light);
      expect(token(":root", `cap-cat-${swatch.name}`)).toBe(hue.light);
      expect(token(".dark", `cap-cat-${swatch.name}`)).toBe(hue.dark);
    }
  });

  it("never uses a category color as a status", () => {
    const found: string[] = [];
    for (const root of ["components", "app"]) {
      for (const file of walk(path.join(SRC, root))) {
        const source = fs.readFileSync(file, "utf8");
        for (const match of source.matchAll(/(?<![\w-])(?:text|bg|border|fill|stroke|ring|decoration|outline)-cat-[a-z]+/g)) {
          found.push(`${path.relative(SRC, file)}: ${match[0]}`);
        }
      }
    }
    expect(found).toEqual([]);
  });
});
