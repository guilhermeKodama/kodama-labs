/**
 * Rewrites Tailwind palette classes (text-neutral-400, bg-white,
 * border-amber-200, ...) into the theme token utilities from
 * src/app/globals.css, keeping every light value identical. Run it after
 * merging code written before the tokens existed, then review the diff:
 * the mapping is by shade, so a bg-neutral-50 that is a sidebar surface
 * still has to become bg-chrome by hand. Classes with no token of the same
 * light value, and color literals (hex, rgb()) outside ALLOWED_COLOR_LITERALS,
 * are listed for manual work.
 *
 *   pnpm exec tsx scripts/codemod-color-tokens.ts [--check] [dir ...]
 *
 * Defaults to src/components and src/app/[locale]. --check only reports.
 */
import fs from "node:fs";
import path from "node:path";
import { findColorLiterals, isAllowedColorLiteral, lineOf, replaceRawColorClasses } from "../src/lib/theme/raw-colors";

const args = process.argv.slice(2);
const check = args.includes("--check");
const roots = args.filter((arg) => arg !== "--check");
const dirs = roots.length ? roots : ["src/components", "src/app/[locale]"];

function walk(dir: string, out: string[]) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file, out);
    else if (/\.(tsx?|css)$/.test(entry.name)) out.push(file);
  }
  return out;
}

let changed = 0;
let leftovers = 0;
for (const file of dirs.flatMap((dir) => walk(dir, []))) {
  const source = fs.readFileSync(file, "utf8");
  const { output, unmapped } = replaceRawColorClasses(source);
  if (output !== source) {
    changed++;
    if (!check) fs.writeFileSync(file, output);
    console.log(`${check ? "would rewrite" : "rewrote"} ${file}`);
  }
  for (const text of unmapped) {
    leftovers++;
    console.log(`  ${file}: no token for ${text}`);
  }
  const lines = output.split("\n");
  const rel = path.relative("src", file);
  for (const literal of findColorLiterals(output)) {
    if (isAllowedColorLiteral(rel, lines[lineOf(output, literal.index) - 1] ?? "")) continue;
    leftovers++;
    console.log(`  ${file}:${lineOf(output, literal.index)}: color literal ${literal.text}`);
  }
}
console.log(`${changed} file(s) ${check ? "to rewrite" : "rewritten"}, ${leftovers} item(s) need manual review`);
if (check && (changed || leftovers)) process.exitCode = 1;
