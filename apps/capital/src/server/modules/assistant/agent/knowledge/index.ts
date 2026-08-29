import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const KNOWLEDGE_DIR = path.join(process.cwd(), "src/server/modules/assistant/agent/knowledge");

let cached: string | null = null;

function sectionTitle(filename: string): string {
  // "10-database-semantics.md" -> "database-semantics"
  return filename.replace(/^\d+-/, "").replace(/\.md$/, "");
}

/**
 * Load and concatenate every knowledge/*.md file, in filename order, into
 * one system-prompt block. Memoized at module scope - all sections load
 * on every conversation (see 90-tool-guide.md's sibling rationale in the
 * architecture doc: splitting by statement type would fragment the
 * prompt cache, and the full set is well under budget at ~23KB).
 */
export function loadAgentKnowledge(): string {
  if (cached) return cached;

  const files = readdirSync(KNOWLEDGE_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort();

  cached = files
    .map((f) => {
      const content = readFileSync(path.join(KNOWLEDGE_DIR, f), "utf8").trim();
      return `## ${sectionTitle(f)}\n\n${content}`;
    })
    .join("\n\n---\n\n");

  return cached;
}
