import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ALLOWED_COLOR_LITERALS, findColorLiterals, findRawColorClasses, isAllowedColorLiteral, lineOf } from "@/lib/theme/raw-colors";

/**
 * Screens and components take every color from the theme tokens in
 * src/app/globals.css (text-fg-*, bg-fill-*, border-stroke-*, var(--cap-*)),
 * so light and dark come from one place. A Tailwind palette class or a
 * color literal here would stay fixed when the theme changes.
 *
 * Fix a failure with `pnpm exec tsx scripts/codemod-color-tokens.ts`, or
 * pick the token by hand; it prints the replacement for each class.
 */

const SRC = path.resolve(__dirname, "../..");
const ROOTS = ["components", "app/[locale]"];

// Deliberate exceptions live in ALLOWED_COLOR_LITERALS (src/lib/theme/raw-colors.ts).

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else if (/\.(tsx?|css)$/.test(entry.name) && !file.includes("__tests__")) out.push(file);
  }
  return out;
}

const files = ROOTS.flatMap((root) => walk(path.join(SRC, root)));

describe("no raw colors in components", () => {
  it("scans the component and page sources", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it("uses token utilities instead of Tailwind palette classes", () => {
    const problems: string[] = [];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      for (const match of findRawColorClasses(source)) {
        const hint = match.replacement ? `use ${match.replacement}` : "no token has this light value, add one to globals.css";
        problems.push(`${path.relative(SRC, file)}:${lineOf(source, match.index)} ${match.text} (${hint})`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("uses var(--cap-*) instead of color literals", () => {
    const problems: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file);
      const source = fs.readFileSync(file, "utf8");
      const lines = source.split("\n");
      for (const match of findColorLiterals(source)) {
        const line = lineOf(source, match.index);
        if (!isAllowedColorLiteral(rel, lines[line - 1] ?? "")) problems.push(`${rel}:${line} ${match.text}`);
      }
    }
    expect(problems).toEqual([]);
  });

  it("keeps every allowlist entry in use", () => {
    for (const entry of ALLOWED_COLOR_LITERALS) {
      const source = fs.readFileSync(path.join(SRC, entry.file), "utf8");
      expect(source.includes(entry.line), `${entry.file}: ${entry.reason}`).toBe(true);
    }
  });
});
