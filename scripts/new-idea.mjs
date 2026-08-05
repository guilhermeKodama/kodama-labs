#!/usr/bin/env node
import { cp, readFile, writeFile, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, "..");
const TEMPLATE_DIR = join(REPO_ROOT, "ideas", "_template");
const IDEAS_DIR = join(REPO_ROOT, "ideas");

const SLUG_RE = /^[a-z][a-z0-9-]*$/;
const PLACEHOLDER_NAME = "{{IDEA_NAME}}";
const PLACEHOLDER_SLUG = "{{IDEA_SLUG}}";
const FILES_WITH_PLACEHOLDERS = [
  "README.md",
  "idea.yaml",
  "src/app/layout.tsx",
  "src/components/hero.tsx",
  "src/components/footer.tsx",
];

const slug = process.argv[2];

if (!slug) {
  console.error("usage: pnpm new:idea <slug>");
  console.error("  slug must be kebab-case (e.g. milhasgrupo, dog-walker-bh)");
  process.exit(1);
}

if (slug.startsWith("_")) {
  console.error(`error: slug "${slug}" must not start with "_" (reserved for boilerplate dirs)`);
  process.exit(1);
}

if (!SLUG_RE.test(slug)) {
  console.error(`error: slug "${slug}" is not valid kebab-case`);
  console.error("  allowed: lowercase letters, digits, hyphens; must start with a letter");
  process.exit(1);
}

const targetDir = join(IDEAS_DIR, slug);

if (await pathExists(targetDir)) {
  console.error(`error: ${relative(REPO_ROOT, targetDir)} already exists`);
  process.exit(1);
}

if (!(await pathExists(TEMPLATE_DIR))) {
  console.error(`error: template missing at ${relative(REPO_ROOT, TEMPLATE_DIR)}`);
  process.exit(1);
}

console.log(`→ copying ideas/_template/ to ideas/${slug}/`);
await cp(TEMPLATE_DIR, targetDir, { recursive: true });

const ideaName = toTitleCase(slug);

console.log(`→ rewriting package.json name to @ideas/${slug}`);
const pkgPath = join(targetDir, "package.json");
const pkg = JSON.parse(await readFile(pkgPath, "utf8"));
pkg.name = `@ideas/${slug}`;
pkg.description = `${ideaName} — validation prototype`;
await writeFile(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);

console.log(`→ filling placeholders in source files`);
for (const relPath of FILES_WITH_PLACEHOLDERS) {
  const filePath = join(targetDir, relPath);
  if (!(await pathExists(filePath))) continue;
  let content = await readFile(filePath, "utf8");
  content = content.split(PLACEHOLDER_NAME).join(ideaName);
  content = content.split(PLACEHOLDER_SLUG).join(slug);
  await writeFile(filePath, content);
}

console.log(`→ seeding validation.md header`);
const validationPath = join(targetDir, "validation.md");
let validation = await readFile(validationPath, "utf8");
validation = validation.replace(/^# \[Idea Name\]/m, `# ${ideaName}`);
await writeFile(validationPath, validation);

console.log("");
console.log(`✓ ideas/${slug}/ ready.`);
console.log("");
console.log("Next steps:");
console.log("  1. Fill in ideas/" + slug + "/validation.md BEFORE writing code.");
console.log("  2. Fill in ideas/" + slug + "/idea.yaml (targets, economics, kill criteria) —");
console.log("     it syncs to the pipeline dashboard on push to main (pnpm sync:ideas to test).");
console.log("  3. From repo root: pnpm install   (picks up the new workspace package)");
console.log("  4. From repo root: pnpm dev --filter=@ideas/" + slug + "   (serves on http://localhost:3100)");
console.log("     (or: cd ideas/" + slug + " && pnpm dev)");
console.log("");
console.log("Remember the 5-day clock starts when you start coding.");

async function pathExists(p) {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function toTitleCase(s) {
  return s
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}
