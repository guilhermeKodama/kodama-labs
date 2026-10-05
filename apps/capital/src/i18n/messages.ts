/**
 * UI messages: one JSON file per locale and namespace,
 * src/messages/<locale>/<namespace>.json, holding that namespace's keys
 * without a wrapper (read with useTranslations("<namespace>")).
 *
 * Each namespace has one owner, so parallel work never edits the same
 * file: common (cap primitives, pickers, shared verbs) and errors (one key
 * per server error code, src/server/i18n/error-codes.ts) are shared; shell,
 * command, assistant and auth belong to the shell and ⌘K; ledger to views
 * and the table; entry to creating, editing and deleting transactions;
 * import, budgets, invest, settings and notifications to their screens.
 *
 * pt-BR is the source language and every locale has the same keys and ICU
 * placeholders (src/lib/__tests__/i18n-parity.test.ts).
 */

export const NAMESPACES = [
  "common",
  "errors",
  "shell",
  "command",
  "assistant",
  "auth",
  "ledger",
  "entry",
  "import",
  "budgets",
  "invest",
  "settings",
  "notifications",
] as const;

export type Namespace = (typeof NAMESPACES)[number];

export type MessageTree = { [key: string]: string | MessageTree };

function isTree(value: unknown): value is MessageTree {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * `override` on top of `base`, merged key by key at every depth: a key
 * only `base` has is kept, a key both have takes `override`'s value.
 */
export function mergeMessages(base: MessageTree, override: MessageTree): MessageTree {
  const out: MessageTree = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = out[key];
    out[key] = isTree(current) && isTree(value) ? mergeMessages(current, value) : value;
  }
  return out;
}

/** The namespaces of one locale as a single tree ({ common: {…}, errors: {…}, … }). */
export function combineNamespaces(files: Partial<Record<Namespace, MessageTree>>): MessageTree {
  const out: MessageTree = {};
  for (const namespace of NAMESPACES) out[namespace] = files[namespace] ?? {};
  return out;
}
