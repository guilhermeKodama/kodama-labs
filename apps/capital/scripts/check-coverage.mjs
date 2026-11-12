#!/usr/bin/env node
/**
 * Backend coverage gate. `pnpm test:coverage` (and CI) write one istanbul
 * `coverage-final.json` per vitest run under coverage/<run>/ (the main suite and
 * the isolated portfolio-fx-repair run, which vitest cannot merge on its own).
 * This script adds them up and exits 1 if statements, branches, functions or
 * lines fall under the threshold (90 by default; COVERAGE_THRESHOLD overrides).
 *
 * What counts is set by `test.coverage.include/exclude` in vitest.config.ts:
 * the server layer and the API routes.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.join(root, "coverage");
const threshold = Number(process.env.COVERAGE_THRESHOLD ?? 90);

const runs = fs.existsSync(dir)
  ? fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(dir, d.name, "coverage-final.json")))
      .map((d) => d.name)
  : [];
if (runs.length === 0) {
  console.error("check-coverage: no coverage/<run>/coverage-final.json. Run `pnpm test:coverage`.");
  process.exit(1);
}

/**
 * Adds the hit counts of `b` into `a`, id by id (the same file has the same
 * statement, function and branch ids in every run). In coverage-final.json,
 * statements and functions map an id to a number, branches map it to a list.
 */
function addCounts(a, b) {
  const out = { ...a };
  for (const [id, hits] of Object.entries(b)) {
    out[id] = Array.isArray(hits) ? hits.map((n, i) => n + (out[id]?.[i] ?? 0)) : hits + (out[id] ?? 0);
  }
  return out;
}

const sameShape = (a, b) =>
  Object.keys(a.s).length === Object.keys(b.s).length &&
  Object.keys(a.f).length === Object.keys(b.f).length &&
  Object.keys(a.b).length === Object.keys(b.b).length &&
  Object.entries(a.b).every(([id, hits]) => b.b[id]?.length === hits.length);
const coveredStatements = (cov) => Object.values(cov.s).filter((n) => n > 0).length;

const files = new Map();
for (const run of runs) {
  const data = JSON.parse(fs.readFileSync(path.join(dir, run, "coverage-final.json"), "utf8"));
  for (const [file, cov] of Object.entries(data)) {
    const seen = files.get(file);
    if (!seen) {
      files.set(file, structuredClone(cov));
    } else if (sameShape(seen, cov)) {
      seen.s = addCounts(seen.s, cov.s);
      seen.f = addCounts(seen.f, cov.f);
      seen.b = addCounts(seen.b, cov.b);
    } else if (coveredStatements(cov) > coveredStatements(seen)) {
      // A run that never loaded a file reports an empty placeholder whose maps
      // can differ from the real ones; keep the run that actually ran it.
      files.set(file, structuredClone(cov));
    }
  }
}

const empty = () => ({ total: 0, covered: 0 });
const total = { statements: empty(), branches: empty(), functions: empty(), lines: empty() };
const perFile = [];

for (const [file, cov] of files) {
  const own = { statements: empty(), branches: empty(), functions: empty(), lines: empty() };
  const lines = new Map();
  for (const [id, hits] of Object.entries(cov.s)) {
    own.statements.total += 1;
    if (hits > 0) own.statements.covered += 1;
    const line = cov.statementMap[id].start.line;
    lines.set(line, (lines.get(line) ?? false) || hits > 0);
  }
  for (const hits of Object.values(cov.f)) {
    own.functions.total += 1;
    if (hits > 0) own.functions.covered += 1;
  }
  for (const counts of Object.values(cov.b)) {
    for (const hits of counts) {
      own.branches.total += 1;
      if (hits > 0) own.branches.covered += 1;
    }
  }
  own.lines.total = lines.size;
  own.lines.covered = [...lines.values()].filter(Boolean).length;
  for (const metric of Object.keys(total)) {
    total[metric].total += own[metric].total;
    total[metric].covered += own[metric].covered;
  }
  perFile.push({ file: path.relative(root, file), uncovered: own.statements.total - own.statements.covered, ...own });
}

const pct = (m) => (m.total === 0 ? 100 : (100 * m.covered) / m.total);
let failed = false;
console.log(`Backend coverage (${runs.join(" + ")}, ${files.size} files), threshold ${threshold}%`);
for (const metric of ["statements", "branches", "functions", "lines"]) {
  const value = pct(total[metric]);
  const ok = value >= threshold;
  if (!ok) failed = true;
  console.log(`  ${ok ? "ok  " : "FAIL"} ${metric.padEnd(10)} ${value.toFixed(2).padStart(6)}%  (${total[metric].covered}/${total[metric].total})`);
}

if (failed) {
  console.log("\nLeast covered files, by uncovered statements:");
  for (const f of perFile.sort((a, b) => b.uncovered - a.uncovered).slice(0, 15)) {
    console.log(`  ${String(f.uncovered).padStart(5)}  ${pct(f.statements).toFixed(1).padStart(5)}%  ${f.file}`);
  }
  process.exit(1);
}
