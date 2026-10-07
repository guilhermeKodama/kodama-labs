import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { lineOf } from "@/lib/theme/raw-colors";

/**
 * Screens and components take every text size from the type roles in
 * src/app/theme.css (text-caption, text-body, text-title, …; textRole() for
 * inline styles and chart fontSize), so a role changes in one place and
 * Ajustes › Tamanho da letra scales all of them. A pixel size here would
 * stay fixed at every text size.
 *
 * Fix a failure by picking the role for what the text is (theme.css lists
 * them with their uses), not only by its pixel size.
 */

const SRC = path.resolve(__dirname, "../..");
const ROOTS = ["components", "app"];
const THEME = path.join("app", "theme.css");
// Vendored shadcn primitives keep Tailwind's own scale (only ui/sonner is used, unstyled).
const VENDORED = path.join("components", "ui") + path.sep;

const RULES: { name: string; pattern: RegExp; skip?: (rel: string) => boolean }[] = [
  { name: "arbitrary text size", pattern: /(?<![\w-])text-\[(?:length:)?\d+(?:\.\d+)?(?:px|rem|em)\]/g },
  { name: "Tailwind text size", pattern: /(?<![\w-])text-(?:xs|sm|base|lg|xl|[2-9]xl)(?![\w-])/g, skip: (rel) => rel.startsWith(VENDORED) },
  { name: "fontSize literal", pattern: /fontSize\s*[:=]\s*\{?\s*["'`]?\d/g },
  { name: "font-size literal", pattern: /font-size:\s*\d/g },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else if (/\.(tsx?|css)$/.test(entry.name) && !file.includes("__tests__")) out.push(file);
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(path.join(SRC, root))).filter((file) => path.relative(SRC, file) !== THEME);

/** Every raw text size in `source`, as "line: match (rule)". */
function findRawTextSizes(source: string, rel = ""): string[] {
  const found: string[] = [];
  for (const rule of RULES) {
    if (rule.skip?.(rel)) continue;
    for (const match of source.matchAll(rule.pattern)) found.push(`${lineOf(source, match.index ?? 0)}: ${match[0]} (${rule.name})`);
  }
  return found;
}

describe("no raw text sizes in components", () => {
  it("scans the component and page sources, not theme.css", () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.some((file) => file.endsWith(path.join("app", "globals.css")))).toBe(true);
    expect(files.some((file) => file.endsWith(THEME))).toBe(false);
  });

  it("catches each kind of raw size", () => {
    expect(findRawTextSizes('<span className="font-mono text-[11.5px] text-fg-3" />')).toEqual(["1: text-[11.5px] (arbitrary text size)"]);
    expect(findRawTextSizes('"hover:text-[0.8rem]"\n"text-sm"')).toEqual(["1: text-[0.8rem] (arbitrary text size)", "2: text-sm (Tailwind text size)"]);
    expect(findRawTextSizes("tick: { fontSize: 11 }, <text fontSize={10} />")).toHaveLength(2);
    expect(findRawTextSizes(".x { font-size: 12px; }")).toHaveLength(1);
    expect(findRawTextSizes('className="text-caption text-fg-3" fontSize={textRole("caption")} data-text-size="sm"')).toEqual([]);
  });

  it("uses the type roles of theme.css", () => {
    const problems: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file);
      for (const found of findRawTextSizes(fs.readFileSync(file, "utf8"), rel)) problems.push(`${rel}:${found}`);
    }
    expect(problems).toEqual([]);
  });
});
